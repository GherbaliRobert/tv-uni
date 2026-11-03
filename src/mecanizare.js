const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { daysBetween, parseDate } = require('./dates');

const DOCS = {
  itp: 'ITP',
  rca: 'RCA',
  rovinieta: 'Rovinietă',
  tahograf: 'Tahograf',
  licenta: 'Licență',
  revizie: 'Revizie',
};

// Headers are matched without diacritics or punctuation. Only these columns are ever read:
// the same file holds personal data of the drivers, which must never reach the server's disk.
const COLUMNS = {
  plate: ['nr auto'],
  inventory: ['nr inventar'],
  type: ['tip'],
  make: ['marca'],
  model: ['model'],
  status: ['status'],
  itp: ['data expirare itp'],
  rca: ['data expirare rca'],
  rovinieta: ['data expirare rovinieta'],
  tahograf: ['tahograf', 'data expirare tahograf'],
  licenta: ['licenta', 'data expirare licenta'],
  revizie: ['revizie', 'data expirare revizie'],
  link: ['link documente'],
};
const REQUIRED_COLUMNS = ['plate', 'status', 'itp', 'rca'];
const DETAIL_COLUMNS = { plate: ['nr auto'], status: ['status'], location: ['locatie santier'] };

const LEVEL_RANK = { expired: 0, urgent: 1, soon: 2 };
const HISTORY_LIMIT = 300;
const WORKING_STATUS = 'functional';
const EARLIEST_YEAR = 2000;
const MAX_TEXT = 200;

// A refusal the person at the laptop can act on; anything else is a bug and stays in the log.
class UserError extends Error {}

function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const plateKey = (plate) => String(plate).toUpperCase().replace(/[^A-Z0-9]/g, '');
const docKey = (plate, doc) => `${plateKey(plate)}:${doc}`;

function cellValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if ('result' in value) return cellValue(value.result);
    if (value.richText) return cellValue(value.richText.map((part) => part.text).join(''));
    if ('text' in value) return cellValue(value.text);
    return null;
  }
  if (typeof value === 'string') return value.trim() || null;
  return value;
}

function toIsoDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromIsoDate(text) {
  const [year, month, day] = text.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function findSheet(workbook, name) {
  return workbook.worksheets.find((sheet) => normalize(sheet.name) === name);
}

function headerColumns(row, columns) {
  const found = {};
  row.eachCell((cell, col) => {
    const header = normalize(cellValue(cell.value));
    for (const [key, names] of Object.entries(columns)) {
      if (names.includes(header)) found[key] = col;
    }
  });
  return found;
}

// EVIDENTA AUTO adds the site, and the status when VALABILITATE ACTE has a broken formula for it.
function readDetails(workbook) {
  const details = new Map();
  const sheet = findSheet(workbook, 'evidenta auto');
  if (!sheet) return details;
  const columns = headerColumns(sheet.getRow(1), DETAIL_COLUMNS);
  if (!columns.plate) return details;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const read = (key) => (columns[key] ? cellValue(row.getCell(columns[key]).value) : null);
    const plate = read('plate');
    if (plate !== null) details.set(plateKey(plate), { status: read('status'), location: read('location') });
  });
  return details;
}

const isExcluded = (status, excludedStatuses) => excludedStatuses.some((prefix) => normalize(status).startsWith(prefix));

// The list can change after an import, and it must hold without importing again.
function withoutExcluded(fleet, excludedStatuses) {
  if (!fleet) return fleet;
  const vehicles = fleet.vehicles.filter((vehicle) => !isExcluded(vehicle.status, excludedStatuses));
  return { ...fleet, vehicles, excluded: fleet.excluded + fleet.vehicles.length - vehicles.length };
}

// The STATUS columns of the file are not used: their formula says EXPIRAT for an empty date too.
function parseLogistica(workbook, excludedStatuses) {
  const sheet = findSheet(workbook, 'valabilitate acte');
  if (!sheet) throw new UserError('Fișierul nu conține foaia VALABILITATE ACTE');
  const columns = headerColumns(sheet.getRow(1), COLUMNS);
  const missing = REQUIRED_COLUMNS.filter((key) => !columns[key]);
  if (missing.length) {
    throw new UserError(`Foaia VALABILITATE ACTE nu are coloanele: ${missing.map((key) => COLUMNS[key][0].toUpperCase()).join(', ')}`);
  }

  const details = readDetails(workbook);
  const warnings = [];
  const vehicles = new Map();
  let excluded = 0;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const read = (key) => (columns[key] ? cellValue(row.getCell(columns[key]).value) : null);
    const plate = read('plate');
    if (plate === null) return;

    const key = plateKey(plate);
    const detail = details.get(key) ?? {};
    const where = `Rândul ${rowNumber} (${plate})`;
    const status = read('status') ?? detail.status ?? null;
    if (isExcluded(status, excludedStatuses)) {
      excluded += 1;
      return;
    }
    if (vehicles.has(key)) {
      warnings.push(`${where}: numărul apare de două ori, l-am păstrat pe primul`);
      return;
    }
    if (!status) warnings.push(`${where}: fără status`);

    const docs = {};
    for (const doc of Object.keys(DOCS)) {
      const raw = read(doc);
      if (raw === null) continue;
      const date = parseDate(raw);
      if (date && date.getFullYear() >= EARLIEST_YEAR) docs[doc] = toIsoDate(date);
      else warnings.push(`${where}: dată necitibilă la ${DOCS[doc]}`);
    }

    // Only links to real web pages: this one is opened with a click at the laptop.
    const linkCell = columns.link ? row.getCell(columns.link).value : null;
    const link = typeof linkCell?.hyperlink === 'string' && linkCell.hyperlink.startsWith('https://') ? linkCell.hyperlink : null;

    vehicles.set(key, {
      plate: String(plate).toUpperCase(),
      inventory: read('inventory'),
      type: read('type'),
      make: read('make'),
      model: read('model'),
      status,
      location: detail.location ?? null,
      link,
      docs,
    });
  });

  if (!vehicles.size) throw new UserError('Foaia VALABILITATE ACTE nu conține nicio mașină');
  return { vehicles: [...vehicles.values()], excluded, warnings };
}

function levelFromDays(days, cfg) {
  if (days < 0) return 'expired';
  if (days <= cfg.zileUrgent) return 'urgent';
  if (days <= cfg.zileAtentie) return 'soon';
  return null;
}

const vehicleLabel = (vehicle) => [vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || null;
const isWorking = (vehicle) => normalize(vehicle.status) === WORKING_STATUS;

// A renewal entered at the laptop is newer than the Excel until the Excel catches up: the newest date wins.
function documentState(vehicle, doc, state) {
  const key = docKey(vehicle.plate, doc);
  const fromExcel = vehicle.docs[doc] ?? null;
  const fromMenu = state.overrides[key]?.date ?? null;
  const useMenu = Boolean(fromMenu && (!fromExcel || fromMenu > fromExcel));
  return {
    date: useMenu ? fromMenu : fromExcel,
    source: useMenu ? 'meniu' : 'excel',
    notApplicable: Boolean(state.notApplicable[key]),
  };
}

function openDocumentTask(state, plate, doc) {
  return state.tasks.find((task) => task.doc === doc && task.stage === 'in-curs' && plateKey(task.plate) === plateKey(plate));
}

function dueDocuments(fleet, state, now, cfg) {
  const today = new Date(now);
  const items = [];
  for (const vehicle of fleet.vehicles) {
    for (const [doc, name] of Object.entries(DOCS)) {
      const { date, notApplicable } = documentState(vehicle, doc, state);
      if (!date || notApplicable) continue;
      const days = daysBetween(today, fromIsoDate(date));
      const level = levelFromDays(days, cfg);
      if (!level) continue;
      items.push({
        plate: vehicle.plate,
        label: vehicleLabel(vehicle),
        status: vehicle.status,
        working: isWorking(vehicle),
        location: vehicle.location,
        doc,
        docName: name,
        date: fromIsoDate(date).getTime(),
        days,
        level,
        inProgress: Boolean(openDocumentTask(state, vehicle.plate, doc)),
      });
    }
  }
  // Vehicles that don't run go last: their expired papers are the least pressing.
  return items.sort((a, b) => (b.working - a.working)
    || LEVEL_RANK[a.level] - LEVEL_RANK[b.level]
    || a.days - b.days);
}

function presentTask(task, vehicles, now) {
  const vehicle = vehicles.get(plateKey(task.plate));
  const due = task.due ? fromIsoDate(task.due) : null;
  return {
    id: task.id,
    stage: task.stage,
    plate: task.plate,
    doc: task.doc ?? null,
    label: vehicleLabel(vehicle),
    location: vehicle?.location ?? null,
    title: task.doc ? DOCS[task.doc] : task.title,
    responsible: task.responsible ?? null,
    urgent: Boolean(task.urgent),
    due: due ? due.getTime() : null,
    dueDays: due ? daysBetween(new Date(now), due) : null,
    createdAt: task.createdAt,
    startedAt: task.startedAt ?? null,
    doneAt: task.doneAt ?? null,
    result: task.result ?? null,
  };
}

function compareTasks(a, b) {
  return (b.urgent - a.urgent)
    || (a.dueDays ?? Infinity) - (b.dueDays ?? Infinity)
    || (a.startedAt ?? a.createdAt) - (b.startedAt ?? b.createdAt);
}

function countLevels(items) {
  const counts = { expired: 0, urgent: 0, soon: 0 };
  for (const item of items) counts[item.level] += 1;
  return counts;
}

function vehiclesByPlate(fleet) {
  return new Map((fleet?.vehicles ?? []).map((vehicle) => [plateKey(vehicle.plate), vehicle]));
}

// A document of a vehicle no longer on the list has nothing left to do; a problem typed by hand may have no vehicle at all.
function tasksInStage(state, stage, vehicles, now) {
  return state.tasks
    .filter((task) => task.stage === stage)
    .filter((task) => !task.doc || vehicles.has(plateKey(task.plate)))
    .map((task) => presentTask(task, vehicles, now))
    .sort(compareTasks);
}

// What the TV shows. Licence, tachograph and service share a panel, so the rest stay large enough to read.
function buildView(fleet, state, now, cfg) {
  const items = dueDocuments(fleet, state, now, cfg);
  const vehicles = vehiclesByPlate(fleet);
  const lists = {
    itp: items.filter((item) => item.doc === 'itp'),
    rca: items.filter((item) => item.doc === 'rca'),
    rovinieta: items.filter((item) => item.doc === 'rovinieta'),
    alte: items.filter((item) => ['tahograf', 'licenta', 'revizie'].includes(item.doc)),
  };
  const counts = Object.fromEntries(Object.entries(lists).map(([key, list]) => [key, countLevels(list)]));
  const work = tasksInStage(state, 'in-curs', vehicles, now);
  const problems = tasksInStage(state, 'de-rezolvat', vehicles, now);

  return {
    lists,
    counts,
    totals: countLevels(items),
    work,
    problems,
    pendingDocuments: items.filter((item) => !item.inProgress).length,
    overdueWork: work.filter((task) => task.dueDays !== null && task.dueDays < 0).length,
    fleetTotal: fleet.vehicles.length,
    working: fleet.vehicles.filter(isWorking).length,
  };
}

// Everything the laptop menu shows.
function buildMenu(fleet, state, now, cfg) {
  const today = new Date(now);
  const vehicles = vehiclesByPlate(fleet);
  const items = fleet ? dueDocuments(fleet, state, now, cfg) : [];

  const acte = (fleet?.vehicles ?? []).map((vehicle) => {
    const docs = {};
    for (const doc of Object.keys(DOCS)) {
      const { date, source, notApplicable } = documentState(vehicle, doc, state);
      const days = date ? daysBetween(today, fromIsoDate(date)) : null;
      docs[doc] = {
        date: date ? fromIsoDate(date).getTime() : null,
        iso: date,
        source,
        notApplicable,
        days,
        level: date && !notApplicable ? levelFromDays(days, cfg) : null,
      };
    }
    return {
      plate: vehicle.plate,
      inventory: vehicle.inventory,
      type: vehicle.type,
      label: vehicleLabel(vehicle),
      status: vehicle.status,
      working: isWorking(vehicle),
      location: vehicle.location,
      link: vehicle.link,
      docs,
    };
  });

  return {
    now,
    docs: DOCS,
    importedAt: fleet?.importedAt ?? null,
    excluded: fleet?.excluded ?? 0,
    warnings: fleet?.warnings ?? [],
    documents: items.filter((item) => !item.inProgress),
    problems: tasksInStage(state, 'de-rezolvat', vehicles, now),
    inProgress: tasksInStage(state, 'in-curs', vehicles, now),
    history: state.tasks
      .filter((task) => task.stage === 'rezolvat')
      .map((task) => presentTask(task, vehicles, now))
      .sort((a, b) => b.doneAt - a.doneAt)
      .slice(0, HISTORY_LIMIT),
    acte,
  };
}

function cleanText(value, what) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text.length > MAX_TEXT) throw new UserError(`${what} e prea lung`);
  return text || null;
}

function cleanDate(value, what) {
  const text = cleanText(value, what);
  if (!text) return null;
  const date = parseDate(text);
  if (!date) throw new UserError(`${what} nu e o dată validă`);
  return toIsoDate(date);
}

function readJson(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch {
    // Never overwrite something unreadable: set it aside for a person to look at.
    const aside = `${file}.stricat-${Date.now()}`;
    fs.renameSync(file, aside);
    console.error(`Fișier de date stricat, mutat la ${path.basename(aside)}`);
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
  fs.renameSync(`${file}.tmp`, file);
}

function createMecanizareStore(cfg, dir) {
  const fleetFile = path.join(dir, 'flota.json');
  const stateFile = path.join(dir, 'stare.json');
  let fleet = withoutExcluded(readJson(fleetFile, null), cfg.statusuriExcluse);
  const state = { overrides: {}, notApplicable: {}, tasks: [], ...readJson(stateFile, {}) };
  const listeners = new Set();
  const saveState = () => {
    writeJson(stateFile, state);
    listeners.forEach((listener) => listener());
  };

  function requireVehicle(plate, doc) {
    const vehicle = vehiclesByPlate(fleet).get(plateKey(plate));
    if (!vehicle) throw new UserError(`Mașina ${plate} nu e în listă`);
    if (doc !== undefined && !DOCS[doc]) throw new UserError('Document necunoscut');
    return vehicle;
  }

  function requireTask(id) {
    const task = state.tasks.find((candidate) => candidate.id === id);
    if (!task) throw new UserError('Lucrarea nu mai există. Reîncarcă pagina.');
    return task;
  }

  function newTask(fields) {
    const task = { id: crypto.randomUUID(), createdAt: Date.now(), ...fields };
    state.tasks.push(task);
    return task;
  }

  function closeTask(task, result) {
    task.stage = 'rezolvat';
    task.doneAt = Date.now();
    task.result = result;
  }

  function applyDocumentDate(vehicle, doc, value) {
    const date = cleanDate(value, 'Data');
    if (!date) throw new UserError('Scrie data până la care e valabil');
    const fromExcel = vehicle.docs[doc];
    if (fromExcel && fromExcel >= date) {
      throw new UserError(`În Excel e deja o dată la fel de nouă sau mai nouă: ${fromExcel.split('-').reverse().join('.')}`);
    }
    state.overrides[docKey(vehicle.plate, doc)] = { date, at: Date.now() };
    return `Valabil până la ${date.split('-').reverse().join('.')}`;
  }

  return {
    snapshot() {
      const now = Date.now();
      return { now, updatedAt: fleet?.importedAt ?? null, view: fleet ? buildView(fleet, state, now, cfg) : null };
    },

    menu: () => buildMenu(fleet, state, Date.now(), cfg),

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    // Only the extracted vehicle data is saved; the workbook itself is dropped here.
    async importWorkbook(buffer) {
      const workbook = new ExcelJS.Workbook();
      try {
        await workbook.xlsx.load(buffer);
      } catch {
        throw new UserError('Fișierul nu este un Excel .xlsx valid');
      }
      const parsed = parseLogistica(workbook, cfg.statusuriExcluse);
      fleet = { importedAt: Date.now(), ...parsed };
      writeJson(fleetFile, fleet);

      // Once the Excel has caught up, the date entered at the laptop has done its job.
      for (const [key, override] of Object.entries(state.overrides)) {
        const [plate, doc] = key.split(':');
        const fromExcel = vehiclesByPlate(fleet).get(plate)?.docs[doc];
        if (fromExcel && fromExcel >= override.date) delete state.overrides[key];
      }
      saveState();
      return { vehicles: parsed.vehicles.length, excluded: parsed.excluded, warnings: parsed.warnings };
    },

    addTask({ plate, title, responsible, due, urgent, stage }) {
      const cleanTitle = cleanText(title, 'Descrierea');
      if (!cleanTitle) throw new UserError('Scrie ce e de rezolvat');
      const started = stage === 'in-curs';
      newTask({
        plate: (cleanText(plate, 'Numărul') ?? '').toUpperCase(),
        title: cleanTitle,
        responsible: cleanText(responsible, 'Responsabilul'),
        due: cleanDate(due, 'Termenul'),
        urgent: Boolean(urgent),
        stage: started ? 'in-curs' : 'de-rezolvat',
        startedAt: started ? Date.now() : null,
      });
      saveState();
    },

    takeDocument({ plate, doc, responsible, due }) {
      const vehicle = requireVehicle(plate, doc);
      if (openDocumentTask(state, plate, doc)) throw new UserError('E deja în curs');
      newTask({
        plate: vehicle.plate,
        doc,
        responsible: cleanText(responsible, 'Responsabilul'),
        due: cleanDate(due, 'Termenul'),
        stage: 'in-curs',
        startedAt: Date.now(),
      });
      saveState();
    },

    startTask(id, { responsible, due }) {
      const task = requireTask(id);
      task.stage = 'in-curs';
      task.startedAt = Date.now();
      task.responsible = cleanText(responsible, 'Responsabilul') ?? task.responsible;
      task.due = cleanDate(due, 'Termenul') ?? task.due;
      saveState();
    },

    finishTask(id, { date, note }) {
      const task = requireTask(id);
      const result = task.doc
        ? applyDocumentDate(requireVehicle(task.plate, task.doc), task.doc, date)
        : cleanText(note, 'Nota');
      closeTask(task, result);
      saveState();
    },

    // A document goes back to being computed from its date; a problem stays on the list.
    reopenTask(id) {
      const task = requireTask(id);
      if (task.doc) {
        state.tasks.splice(state.tasks.indexOf(task), 1);
      } else {
        task.stage = 'de-rezolvat';
        task.startedAt = null;
      }
      saveState();
    },

    deleteTask(id) {
      const task = requireTask(id);
      if (task.doc || task.stage === 'rezolvat') throw new UserError('Doar problemele deschise se pot șterge');
      state.tasks.splice(state.tasks.indexOf(task), 1);
      saveState();
    },

    resolveDocument({ plate, doc, date }) {
      const vehicle = requireVehicle(plate, doc);
      const result = applyDocumentDate(vehicle, doc, date);
      closeTask(openDocumentTask(state, plate, doc) ?? newTask({ plate: vehicle.plate, doc }), result);
      delete state.notApplicable[docKey(plate, doc)];
      saveState();
    },

    setNotApplicable({ plate, doc, value }) {
      requireVehicle(plate, doc);
      const key = docKey(plate, doc);
      if (value) {
        state.notApplicable[key] = { at: Date.now() };
        const open = openDocumentTask(state, plate, doc);
        if (open) state.tasks.splice(state.tasks.indexOf(open), 1);
      } else {
        delete state.notApplicable[key];
      }
      saveState();
    },
  };
}

module.exports = { DOCS, UserError, parseLogistica, buildView, buildMenu, createMecanizareStore };
