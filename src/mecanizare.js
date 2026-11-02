const fs = require('fs/promises');
const path = require('path');
const ExcelJS = require('exceljs');
const { daysBetween, parseDate } = require('./dates');

// Headers are matched without diacritics or punctuation, so columns can be reordered.
// The first name of each list is the one reported when the column is missing.
const FLEET_COLUMNS = {
  plate: ['nr inmatriculare', 'numar inmatriculare', 'masina'],
  type: ['tip', 'tip masina', 'tip utilaj'],
  model: ['marca model', 'marca', 'model'],
  rovinieta: ['rovinieta expira', 'rovinieta'],
  itp: ['itp expira', 'itp'],
  rca: ['rca expira', 'rca'],
  reviewDate: ['revizie scadenta data', 'revizie data'],
  reviewCounter: ['revizie scadenta contor', 'revizie contor'],
  counter: ['contor actual'],
  unit: ['unitate contor', 'unitate'],
};

const WORK_COLUMNS = {
  plate: ['nr inmatriculare', 'numar inmatriculare', 'masina'],
  job: ['lucrare', 'lucrare efectuata', 'descriere'],
  mechanic: ['mecanic', 'responsabil', 'mecanic responsabil'],
  location: ['loc', 'locatie'],
  since: ['intrare', 'data intrare'],
  due: ['termen estimat', 'termen'],
  status: ['stare', 'status'],
  priority: ['prioritate'],
};

// The monthly centralizer: titles and columns of its blocks.
const EXPIRY_SECTIONS = {
  itp: 'itp',
  rca: 'rca',
  tahograf: 'tahograf',
  tahografe: 'tahograf',
  rovinieta: 'rovinieta',
  roviniete: 'rovinieta',
  revizie: 'revizii',
  revizii: 'revizii',
};

const EXPIRY_COLUMNS = {
  plate: ['numar auto', 'nr auto', 'nr inmatriculare', 'numar inmatriculare', 'masina'],
  date: ['data expirarii', 'data expirare', 'expira'],
  done: ['realizat'],
};

const DONE_MARKS = new Set(['✅', '☑', '✔', '✓', '☒', '❎', 'x', 'da', 'realizat', 'facut', 'gata', 'true']);
const NOT_DONE_MARKS = new Set(['🔲', '☐', '⬜', '□', '▢', 'nu', 'false']);

const LEVEL_RANK = { expired: 0, urgent: 1, soon: 2 };

function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const plateKey = (plate) => String(plate).toUpperCase().replace(/[^A-Z0-9]/g, '');

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

function parseCounter(value) {
  if (typeof value === 'number') return value;
  const number = Number(String(value).replace(/[\s.]/g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function readSheet(sheet, columns, warnings) {
  const positions = {};
  sheet.getRow(1).eachCell((cell, col) => {
    const header = normalize(cellValue(cell.value));
    for (const [key, names] of Object.entries(columns)) {
      if (names.includes(header)) positions[key] = col;
    }
  });
  for (const [key, names] of Object.entries(columns)) {
    if (!positions[key]) warnings.push(`Foaia „${sheet.name}”: lipsește coloana „${names[0]}”`);
  }
  if (!positions.plate) return [];

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = { rowNumber };
    let hasData = false;
    for (const [key, col] of Object.entries(positions)) {
      record[key] = cellValue(row.getCell(col).value);
      if (record[key] !== null) hasData = true;
    }
    if (!hasData) return;
    if (record.plate === null) {
      warnings.push(`Foaia „${sheet.name}”, rândul ${rowNumber}: lipsește numărul de înmatriculare`);
      return;
    }
    record.plate = String(record.plate).toUpperCase();
    rows.push(record);
  });
  return rows;
}

function dateField(record, key, sheetName, warnings) {
  const value = record[key];
  if (value === null || value === undefined) return null;
  const date = parseDate(value);
  if (!date) {
    warnings.push(`Foaia „${sheetName}”, rândul ${record.rowNumber}: dată necitibilă „${value}” (${record.plate})`);
  }
  return date;
}

function counterField(record, key, warnings) {
  const value = record[key];
  if (value === null || value === undefined) return null;
  const number = parseCounter(value);
  if (number === null) {
    warnings.push(`Foaia „Flota”, rândul ${record.rowNumber}: număr necitibil „${value}” (${record.plate})`);
  }
  return number;
}

function findSheet(workbook, name) {
  return workbook.worksheets.find((sheet) => normalize(sheet.name) === name);
}

// Turns a loaded workbook into plain records, collecting anything unreadable as a warning.
function parseWorkbook(workbook) {
  const warnings = [];
  const fleetSheet = findSheet(workbook, 'flota');
  const workSheet = findSheet(workbook, 'in lucru');
  if (!fleetSheet) throw new Error('Lipsește foaia „Flota”');
  if (!workSheet) throw new Error('Lipsește foaia „In lucru”');

  const fleet = readSheet(fleetSheet, FLEET_COLUMNS, warnings).map((r) => ({
    plate: r.plate,
    type: r.type,
    model: r.model,
    rovinieta: dateField(r, 'rovinieta', 'Flota', warnings),
    itp: dateField(r, 'itp', 'Flota', warnings),
    rca: dateField(r, 'rca', 'Flota', warnings),
    reviewDate: dateField(r, 'reviewDate', 'Flota', warnings),
    reviewCounter: counterField(r, 'reviewCounter', warnings),
    counter: counterField(r, 'counter', warnings),
    unit: normalize(r.unit).startsWith('or') ? 'ore' : 'km',
  }));

  const work = readSheet(workSheet, WORK_COLUMNS, warnings).map((r) => ({
    plate: r.plate,
    job: r.job,
    mechanic: r.mechanic,
    location: r.location,
    status: r.status,
    urgent: normalize(r.priority) === 'urgent',
    since: dateField(r, 'since', 'In lucru', warnings),
    due: dateField(r, 'due', 'In lucru', warnings),
  }));

  const info = findSheet(workbook, 'citeste ma');
  let demo = false;
  info?.eachRow((row) => {
    if (normalize(cellValue(row.getCell(1).value)) === 'date demonstrative') {
      demo = normalize(cellValue(row.getCell(2).value)) === 'da';
    }
  });

  return { fleet, work, demo, warnings, hasWorkshop: true };
}

function headerColumns(row) {
  const found = {};
  row.eachCell((cell, col) => {
    const header = normalize(cellValue(cell.value));
    for (const [key, names] of Object.entries(EXPIRY_COLUMNS)) {
      if (names.includes(header)) found[key] = col;
    }
  });
  return found;
}

// An unknown mark stays on the list: hiding a document that isn't done is the worse mistake.
function isDone(value, where, warnings) {
  if (value === null) return false;
  const mark = String(value).replace(/️/g, '').trim().toLowerCase();
  if (DONE_MARKS.has(mark)) return true;
  if (!NOT_DONE_MARKS.has(mark)) warnings.push(`${where}: nu înțeleg „${value}” la Realizat`);
  return false;
}

// One block per document: a title row, a header row, then its rows. Later blocks may leave
// a header cell out (the file does for Realizat), so columns carry over between blocks.
function parseExpiries(workbook) {
  const warnings = [];
  const lists = {};
  for (const sheet of workbook.worksheets) {
    const columns = {};
    let section = null;
    let titleRow = 0;
    sheet.eachRow((row, rowNumber) => {
      const first = cellValue(row.getCell(1).value);
      const known = EXPIRY_SECTIONS[normalize(first)];
      if (known) {
        section = known;
        titleRow = rowNumber;
        lists[section] = lists[section] ?? [];
        return;
      }
      const header = headerColumns(row);
      if (header.plate) {
        Object.assign(columns, header);
        // A header with no known title right above it starts a block the panel can't place.
        if (titleRow !== rowNumber - 1) section = null;
        return;
      }
      if (first !== null && first === cellValue(row.getCell(2).value)) {
        if (titleRow) warnings.push(`Foaia „${sheet.name}”, rândul ${rowNumber}: blocul „${first}” nu are loc pe panou`);
        section = null;
        return;
      }
      if (!section || !columns.plate) return;
      const plate = cellValue(row.getCell(columns.plate).value);
      if (plate === null) return;

      const where = `Foaia „${sheet.name}”, rândul ${rowNumber}`;
      const rawDate = columns.date ? cellValue(row.getCell(columns.date).value) : null;
      const date = rawDate === null ? null : parseDate(rawDate);
      if (!date) {
        warnings.push(`${where}: dată lipsă sau necitibilă (${plate})`);
        return;
      }
      const mark = columns.done ? cellValue(row.getCell(columns.done).value) : null;
      lists[section].push({ plate: String(plate).toUpperCase(), date, done: isDone(mark, where, warnings) });
    });
  }
  if (!Object.keys(lists).length) throw new Error('Fișierul nu conține blocurile ITP, RCA, TAHOGRAF sau ROVINIETĂ');
  return { lists, warnings };
}

// Demo rows must never sit next to real ones, so real expiries switch the demo workshop file off.
function mergeSources(workshop, expiries) {
  if (!workshop && !expiries) return null;
  const useWorkshop = Boolean(workshop && !(workshop.demo && expiries));
  return {
    fleet: useWorkshop ? workshop.fleet : [],
    work: useWorkshop ? workshop.work : [],
    demo: useWorkshop && workshop.demo,
    warnings: [...(expiries?.warnings ?? []), ...(useWorkshop ? workshop.warnings : [])],
    expiries,
    hasWorkshop: useWorkshop,
  };
}

function levelFromDays(days, cfg) {
  if (days < 0) return 'expired';
  if (days <= cfg.zileUrgent) return 'urgent';
  if (days <= cfg.zileAtentie) return 'soon';
  return null;
}

function levelFromCounter(left, unit, cfg) {
  const [urgent, soon] = unit === 'ore' ? [cfg.oreUrgent, cfg.oreAtentie] : [cfg.kmUrgent, cfg.kmAtentie];
  if (left <= 0) return 'expired';
  if (left <= urgent) return 'urgent';
  if (left <= soon) return 'soon';
  return null;
}

function moreUrgent(a, b) {
  if (!a) return b;
  if (!b) return a;
  return LEVEL_RANK[a] <= LEVEL_RANK[b] ? a : b;
}

function emptyCounts() {
  return { expired: 0, urgent: 0, soon: 0 };
}

function countLevels(items) {
  const counts = emptyCounts();
  for (const item of items) counts[item.level] += 1;
  return counts;
}

// Lists are computed on every request so the day counters roll over at midnight on their own.
function buildView(data, now, cfg) {
  const today = new Date(now);
  const fleetByPlate = new Map(data.fleet.map((v) => [plateKey(v.plate), v]));

  const documentRows = (field) => (data.expiries
    ? (data.expiries.lists[field] ?? []).filter((row) => !row.done)
    : data.fleet.filter((v) => v[field]).map((v) => ({ plate: v.plate, date: v[field] })));

  const documents = (field) => documentRows(field)
    .map(({ plate, date }) => {
      const days = daysBetween(today, date);
      const type = fleetByPlate.get(plateKey(plate))?.type ?? null;
      return { plate, type, date: date.getTime(), days, level: levelFromDays(days, cfg) };
    })
    .filter((item) => item.level)
    .sort((a, b) => a.days - b.days);

  const fleetRevizii = data.fleet
    .map((v) => {
      const days = v.reviewDate ? daysBetween(today, v.reviewDate) : null;
      const left = v.reviewCounter !== null && v.counter !== null ? v.reviewCounter - v.counter : null;
      const byDate = days === null ? null : levelFromDays(days, cfg);
      const byCounter = left === null ? null : levelFromCounter(left, v.unit, cfg);
      const level = moreUrgent(byDate, byCounter);
      if (!level) return null;
      // Show whichever measure triggered the alert.
      const useDate = byDate && (!byCounter || LEVEL_RANK[byDate] <= LEVEL_RANK[byCounter]);
      return {
        plate: v.plate,
        type: v.type,
        level,
        date: v.reviewDate && useDate ? v.reviewDate.getTime() : null,
        days: useDate ? days : null,
        counterLeft: useDate ? null : left,
        counterDue: useDate ? null : v.reviewCounter,
        unit: v.unit,
      };
    })
    .filter(Boolean);

  const revizii = [...documents('revizii'), ...fleetRevizii]
    .sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || (a.days ?? Infinity) - (b.days ?? Infinity));

  const work = data.work
    .map((w) => {
      const vehicle = fleetByPlate.get(plateKey(w.plate));
      return {
        plate: w.plate,
        type: vehicle?.type ?? null,
        model: vehicle?.model ?? null,
        job: w.job,
        mechanic: w.mechanic,
        location: w.location,
        status: w.status,
        urgent: w.urgent,
        since: w.since ? w.since.getTime() : null,
        due: w.due ? w.due.getTime() : null,
        dueDays: w.due ? daysBetween(today, w.due) : null,
      };
    })
    .sort((a, b) => (b.urgent - a.urgent)
      || (a.dueDays ?? Infinity) - (b.dueDays ?? Infinity)
      || (a.since ?? Infinity) - (b.since ?? Infinity));

  const lists = {
    rovinieta: documents('rovinieta'),
    itp: documents('itp'),
    rca: documents('rca'),
    tahograf: documents('tahograf'),
    revizii,
  };
  const counts =Object.fromEntries(Object.entries(lists).map(([k, items]) => [k, countLevels(items)]));

  const totals = emptyCounts();
  for (const c of Object.values(counts)) {
    totals.expired += c.expired;
    totals.urgent += c.urgent;
    totals.soon += c.soon;
  }

  const inWorkPlates = new Set(data.work.map((w) => plateKey(w.plate)));
  const fleetTotal = data.fleet.length;
  const unavailable = data.fleet.filter((v) => inWorkPlates.has(plateKey(v.plate))).length;

  const pending = Object.values(lists).flat();
  const inFile = (field) => (data.expiries ? field in data.expiries.lists : field !== 'tahograf');

  return {
    work,
    lists,
    counts,
    totals,
    fleetTotal,
    available: fleetTotal - unavailable,
    overdueWork: work.filter((w) => w.dueDays !== null && w.dueDays < 0).length,
    // Without a source, "nothing is due" would be a false reassurance.
    known: {
      work: data.hasWorkshop,
      rovinieta: inFile('rovinieta'),
      itp: inFile('itp'),
      rca: inFile('rca'),
      tahograf: inFile('tahograf'),
      revizii: data.hasWorkshop || inFile('revizii'),
    },
    pendingCount: pending.length,
    pendingPlates: new Set(pending.map((item) => plateKey(item.plate))).size,
    doneCount: data.expiries ? Object.values(data.expiries.lists).flat().filter((row) => row.done).length : 0,
  };
}

// A pattern with one * (Centralizator_*.xlsx) means the most recently saved match,
// so next month's file takes over without touching the config.
async function locateFile(pattern) {
  const [prefix, suffix] = path.basename(pattern).split('*');
  if (suffix === undefined) return pattern;
  const dir = path.dirname(pattern);
  const names = (await fs.readdir(dir)).filter((name) => name.startsWith(prefix) && name.endsWith(suffix));
  if (!names.length) throw Object.assign(new Error('no match'), { code: 'ENOENT' });
  const files = await Promise.all(names.map(async (name) => {
    const file = path.join(dir, name);
    return { file, mtimeMs: (await fs.stat(file)).mtimeMs };
  }));
  return files.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a)).file;
}

// A half-saved or locked file keeps the last good version and is tried again at the next check.
// Messages reach the TV and the network, so they name the file but not its path.
function createWorkbookSource(pattern, parse) {
  const name = path.basename(pattern);
  let loaded = null;
  const source = {
    data: null,
    updatedAt: null,
    error: null,
    missing: false,
    async refresh() {
      try {
        const file = await locateFile(pattern);
        const { mtimeMs } = await fs.stat(file);
        source.missing = false;
        source.error = null;
        if (loaded === `${file}:${mtimeMs}`) return;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(file);
        source.data = parse(workbook);
        source.updatedAt = mtimeMs;
        loaded = `${file}:${mtimeMs}`;
        console.log(`Excel încărcat: ${path.basename(file)}, ${source.data.warnings.length} avertismente`);
        source.data.warnings.forEach((w) => console.warn(`  ${w}`));
      } catch (err) {
        source.missing = err.code === 'ENOENT';
        source.error = source.missing ? `Nu găsesc fișierul ${name}` : `Fișierul ${name} nu poate fi citit`;
        console.error(source.error, err.message);
      }
    },
  };
  return source;
}

class UploadError extends Error {}

const EXPIRY_NAMES = { itp: 'ITP', rca: 'RCA', tahograf: 'Tahograf', rovinieta: 'Rovinietă', revizii: 'Revizii' };

async function readUpload(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new UploadError('Fișierul nu este un Excel .xlsx valid');
  }
  try {
    return findSheet(workbook, 'flota')
      ? { kind: 'atelier', parsed: parseWorkbook(workbook) }
      : { kind: 'expirari', parsed: parseExpiries(workbook) };
  } catch (err) {
    throw new UploadError(err.message);
  }
}

function describeUpload(kind, parsed) {
  if (kind === 'atelier') return `Flotă ${parsed.fleet.length}, în lucru ${parsed.work.length}`;
  return Object.entries(parsed.lists).map(([key, rows]) => `${EXPIRY_NAMES[key]} ${rows.length}`).join(', ');
}

function createMecanizareStore(cfg, root) {
  const workshopFile = path.resolve(root, cfg.fisier);
  const expiriesPattern = path.resolve(root, cfg.fisierExpirari);
  const workshop = createWorkbookSource(workshopFile, parseWorkbook);
  const expiries = createWorkbookSource(expiriesPattern, parseExpiries);
  const sources = [expiries, workshop];
  const refresh = () => Promise.all(sources.map((source) => source.refresh()));

  // A bad file is refused before it can replace the good one. The name sent by the browser is never used.
  async function saveUpload(buffer) {
    const { kind, parsed } = await readUpload(buffer);
    const target = kind === 'atelier' ? workshopFile : expiriesPattern.replace('*', 'incarcat');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(`${target}.tmp`, buffer);
    await fs.rename(`${target}.tmp`, target);
    await refresh();
    const notes = [...parsed.warnings];
    if (parsed.demo) notes.unshift('Fișierul e marcat demonstrativ: scrie NU în celula B3 din foaia Citeste-ma.');
    return { kind, summary: describeUpload(kind, parsed), notes };
  }

  function currentError() {
    // The workshop file is optional once the centralizer supplies the expiries.
    if (expiries.data && workshop.missing) return expiries.error;
    return sources.map((source) => source.error).find(Boolean) ?? null;
  }

  function snapshot() {
    const now = Date.now();
    const data = mergeSources(workshop.data, expiries.data);
    return {
      now,
      updatedAt: Math.max(...sources.map((source) => source.updatedAt ?? 0)) || null,
      error: currentError(),
      demo: Boolean(data?.demo),
      warnings: data?.warnings ?? [],
      view: data ? buildView(data, now, cfg) : null,
    };
  }

  function start() {
    refresh();
    setInterval(refresh, cfg.verificareSecunde * 1000);
  }

  return { start, snapshot, saveUpload };
}

module.exports = { createMecanizareStore, UploadError, parseWorkbook, parseExpiries, mergeSources, buildView };
