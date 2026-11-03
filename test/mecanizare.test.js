process.env.TZ = 'Europe/Bucharest';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const config = require('../config.json');
const { UserError, parseLogistica, buildView, createMecanizareStore } = require('../src/mecanizare');

const EXCLUDED = config.mecanizare.statusuriExcluse;
const CFG = { zileUrgent: 7, zileAtentie: 30, statusuriExcluse: EXCLUDED };
const NOV_3 = new Date(2026, 10, 3).getTime();
const excelDate = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const formula = (result) => ({ formula: 'IF(J2<=TODAY(),"EXPIRAT","VALABIL")', result });

// Same shape as the real file: status columns next to each date, and sheets that must not be touched.
const HEADER = ['NR. INVENTAR', 'Nr. Auto', 'TIP', 'Marca', 'Model', 'Serie Sasiu', 'Status ',
  'DATA EXPIRARE \nRCA', 'STATUS \nRCA', 'DATA EXPIRARE \nITP', 'STATUS \nITP',
  'DATA EXPIRARE \nROVINIETA', 'STATUS \nROVINIETA', 'LICENTA', 'STATUS LICENTA', 'TAHOGRAF', 'STATUS TAHOGRAF', 'LINK DOCUMENTE'];

function vehicle(plate, status, { rca, itp, rovinieta, licenta, tahograf, link } = {}) {
  return [1, plate, '4x2', 'MAN', 'TGX', 'VIN-SECRET', formula(status),
    rca, formula('EXPIRAT'), itp, formula('EXPIRAT'), rovinieta, formula('EXPIRAT'),
    licenta, formula('EXPIRAT'), tahograf, formula('EXPIRAT'), link];
}

function logistica(rows, { evidenta = [] } = {}) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('VALABILITATE ACTE');
  sheet.addRow(HEADER);
  sheet.addRows(rows);
  const details = wb.addWorksheet('EVIDENTA AUTO');
  details.addRow(['NR. INVENTAR', 'Nr. Auto', 'TIP', 'Marca', 'Model', 'Serie Sasiu', 'Status ', 'Sofer', 'Nr Telefon Sofer', 'Locatie (Santier)']);
  details.addRows(evidenta);
  const drivers = wb.addWorksheet('ACTE SOFERI');
  drivers.addRow(['Nr.Crt', 'Nume Prenume', 'CNP']);
  drivers.addRow([1, 'NUME-SECRET', 'CNP-SECRET']);
  return wb;
}

const upload = async (wb) => Buffer.from(await wb.xlsx.writeBuffer());

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panou-test-'));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, store: createMecanizareStore(CFG, dir) };
}

const soon = () => {
  const date = new Date(Date.now() + 10 * 86400000);
  return excelDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
};
const future = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

test('parseLogistica drops radiated and sold vehicles and keeps every other status', () => {
  const { vehicles, excluded } = parseLogistica(logistica([
    vehicle('B 1 AAA', 'FUNCTIONAL'),
    vehicle('B 2 AAA', 'DEFECT'),
    vehicle('B 3 AAA', 'RADIATA'),
    vehicle('B 4 AAA', 'radiat'),
    vehicle('B 5 AAA', 'VANDUT'),
    vehicle('B 6 AAA', 'Vândută'),
  ]), EXCLUDED);
  assert.deepEqual(vehicles.map((v) => v.plate), ['B 1 AAA', 'B 2 AAA']);
  assert.equal(excluded, 4);
});

test('a status excluded after the import also leaves the lists, without importing again', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panou-test-'));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const before = createMecanizareStore({ ...CFG, statusuriExcluse: ['radiat'] }, dir);
  await before.importWorkbook(await upload(logistica([
    vehicle('B 1 AAA', 'FUNCTIONAL', { itp: soon() }),
    vehicle('B 2 AAA', 'VANDUT', { itp: soon() }),
    vehicle('B 3 AAA', 'RADIATA', { itp: soon() }),
  ])));
  before.takeDocument({ plate: 'B 2 AAA', doc: 'itp' });
  before.addTask({ plate: 'B 2 AAA', title: 'Predare acte' });
  assert.equal(before.menu().acte.length, 2);
  assert.equal(before.menu().inProgress.length, 1);

  const after = createMecanizareStore({ ...CFG, statusuriExcluse: ['radiat', 'vandut'] }, dir);
  const menu = after.menu();
  assert.deepEqual(menu.acte.map((v) => v.plate), ['B 1 AAA']);
  assert.equal(menu.excluded, 2);
  assert.equal(menu.documents.length, 1);
  assert.equal(menu.inProgress.length, 0, 'its documents leave the monitor too');
  assert.equal(menu.problems.length, 1, 'a problem typed by hand stays until someone closes it');
  assert.equal(after.snapshot().view.totals.soon, 1);
});

test('parseLogistica goes by the dates, because the status columns lie about empty ones', () => {
  const { vehicles } = parseLogistica(logistica([
    vehicle('B 1 AAA', 'FUNCTIONAL', { rca: excelDate(2026, 11, 20), itp: excelDate(2026, 10, 30), tahograf: '15.01.2027' }),
  ]), EXCLUDED);
  assert.deepEqual(vehicles[0].docs, { itp: '2026-10-30', rca: '2026-11-20', tahograf: '2027-01-15' });
});

test('parseLogistica keeps nothing personal and only safe links', () => {
  const { vehicles } = parseLogistica(logistica([
    vehicle('B 1 AAA', 'FUNCTIONAL', { link: { text: 'B 1 AAA', hyperlink: 'https://firma.sharepoint.com/dosar' } }),
    vehicle('B 2 AAA', 'FUNCTIONAL', { link: { text: 'B 2 AAA', hyperlink: 'javascript:alert(1)' } }),
  ], { evidenta: [[1, 'B 1 AAA', '4x2', 'MAN', 'TGX', 'VIN', 'FUNCTIONAL', 'NUME-SECRET', '07SECRET', 'CLINCENI']] }), EXCLUDED);
  assert.equal(vehicles[0].link, 'https://firma.sharepoint.com/dosar');
  assert.equal(vehicles[0].location, 'CLINCENI');
  assert.equal(vehicles[1].link, null);
  assert.doesNotMatch(JSON.stringify(vehicles), /SECRET/);
});

test('parseLogistica fills a status lost to a broken formula from EVIDENTA AUTO', () => {
  const { vehicles, warnings } = parseLogistica(logistica([
    vehicle('B 1 AAA', null),
    vehicle('B 2 AAA', null),
  ], { evidenta: [[1, 'B 1 AAA', '', '', '', '', 'DEFECT'], [2, 'B 2 AAA', '', '', '', '', 'RADIATA']] }), EXCLUDED);
  assert.deepEqual(vehicles.map((v) => [v.plate, v.status]), [['B 1 AAA', 'DEFECT']]);
  assert.deepEqual(warnings, []);
});

test('parseLogistica reports what it cannot read instead of guessing', () => {
  const { vehicles, warnings } = parseLogistica(logistica([
    vehicle('B 1 AAA', 'FUNCTIONAL', { itp: 'curand', rca: new Date(Date.UTC(1900, 0, 1)) }),
    vehicle('B 1 AAA', 'FUNCTIONAL'),
    vehicle('B 2 AAA', null),
  ]), EXCLUDED);
  assert.equal(vehicles.length, 2);
  assert.deepEqual(vehicles[0].docs, {});
  assert.ok(warnings.some((w) => /dată necitibilă la ITP/.test(w)));
  assert.ok(warnings.some((w) => /dată necitibilă la RCA/.test(w)));
  assert.ok(warnings.some((w) => /de două ori/.test(w)));
  assert.ok(warnings.some((w) => /fără status/.test(w)));
});

test('parseLogistica refuses the wrong file', () => {
  const other = new ExcelJS.Workbook();
  other.addWorksheet('Alta');
  assert.throws(() => parseLogistica(other, EXCLUDED), /VALABILITATE ACTE/);

  const noColumns = new ExcelJS.Workbook();
  noColumns.addWorksheet('Valabilitate acte').addRow(['Nr. Auto', 'Status']);
  assert.throws(() => parseLogistica(noColumns, EXCLUDED), /DATA EXPIRARE ITP/);

  assert.throws(() => parseLogistica(logistica([]), EXCLUDED), /nicio mașină/);
});

function fleetOf(...vehicles) {
  return {
    vehicles: vehicles.map(([plate, status, docs]) => ({ plate, status, make: 'MAN', model: 'TGX', docs })),
    excluded: 0,
    warnings: [],
  };
}
const NO_STATE = { overrides: {}, notApplicable: {}, tasks: [] };

test('the TV view lists what is due, with working vehicles first', () => {
  const view = buildView(fleetOf(
    ['B 1 AAA', 'FUNCTIONAL', { itp: '2026-11-20' }],
    ['B 2 AAA', 'FUNCTIONAL', { itp: '2026-10-01' }],
    ['B 3 AAA', 'FUNCTIONAL', { itp: '2026-11-05' }],
    ['B 4 AAA', 'DEFECT', { itp: '2023-01-01' }],
    ['B 5 AAA', 'FUNCTIONAL', { itp: '2027-06-01' }],
    ['B 6 AAA', 'FUNCTIONAL', {}],
  ), NO_STATE, NOV_3, CFG);
  assert.deepEqual(view.lists.itp.map((i) => [i.plate, i.level]), [
    ['B 2 AAA', 'expired'],
    ['B 3 AAA', 'urgent'],
    ['B 1 AAA', 'soon'],
    ['B 4 AAA', 'expired'],
  ]);
  assert.deepEqual(view.totals, { expired: 2, urgent: 1, soon: 1 });
  assert.equal(view.fleetTotal, 6);
  assert.equal(view.working, 5);
});

test('licence, tachograph and service share one panel', () => {
  const view = buildView(fleetOf(
    ['B 1 AAA', 'FUNCTIONAL', { licenta: '2026-11-20', tahograf: '2026-11-21', revizie: '2026-11-22', rca: '2026-11-23', rovinieta: '2026-11-24' }],
  ), NO_STATE, NOV_3, CFG);
  assert.deepEqual(view.lists.alte.map((i) => i.docName), ['Licență', 'Tahograf', 'Revizie']);
  assert.equal(view.lists.rca.length, 1);
  assert.equal(view.lists.rovinieta.length, 1);
  assert.deepEqual(view.counts.alte, { expired: 0, urgent: 0, soon: 3 });
});

test('a day counts until it is over: expiring today is urgent, not expired', () => {
  const view = buildView(fleetOf(['B 1 AAA', 'FUNCTIONAL', { itp: '2026-11-03' }]), NO_STATE, NOV_3, CFG);
  assert.equal(view.lists.itp[0].level, 'urgent');
  assert.equal(view.lists.itp[0].days, 0);
});

test('import saves only the extracted vehicles, and a bad file changes nothing', async () => {
  const { dir, store } = tempStore();
  assert.equal(store.snapshot().view, null);

  const result = await store.importWorkbook(await upload(logistica([
    vehicle('B 1 AAA', 'FUNCTIONAL', { itp: soon() }),
    vehicle('B 2 AAA', 'RADIATA', { itp: soon() }),
  ])));
  assert.deepEqual(result, { vehicles: 1, excluded: 1, warnings: [] });
  assert.equal(store.snapshot().view.totals.soon, 1);

  await assert.rejects(store.importWorkbook(Buffer.from('nu e excel')), (err) => err instanceof UserError && /xlsx/.test(err.message));
  const wrong = new ExcelJS.Workbook();
  wrong.addWorksheet('Alta');
  await assert.rejects(store.importWorkbook(await upload(wrong)), (err) => err instanceof UserError);
  assert.equal(store.snapshot().view.totals.soon, 1);

  assert.deepEqual(fs.readdirSync(dir).sort(), ['flota.json', 'stare.json']);
  const saved = fs.readdirSync(dir).map((name) => fs.readFileSync(path.join(dir, name), 'utf8')).join('');
  assert.doesNotMatch(saved, /SECRET/, 'the workbook itself must not reach the disk');
});

test('a document moves from due to in progress to done, and off the TV', async () => {
  const { store } = tempStore();
  await store.importWorkbook(await upload(logistica([vehicle('B 1 AAA', 'FUNCTIONAL', { itp: soon() })])));

  assert.equal(store.menu().documents.length, 1);
  store.takeDocument({ plate: 'b 1 aaa', doc: 'itp', responsible: 'Ion', due: future(5) });
  let menu = store.menu();
  assert.equal(menu.documents.length, 0, 'taken documents leave the to-do list');
  assert.equal(menu.inProgress.length, 1);
  assert.equal(menu.inProgress[0].title, 'ITP');
  assert.equal(menu.inProgress[0].responsible, 'Ion');
  assert.throws(() => store.takeDocument({ plate: 'B 1 AAA', doc: 'itp' }), /deja în curs/);

  let view = store.snapshot().view;
  assert.equal(view.work.length, 1);
  assert.equal(view.lists.itp[0].inProgress, true, 'still on the TV, marked as being handled');
  assert.equal(view.pendingDocuments, 0);

  assert.throws(() => store.finishTask(menu.inProgress[0].id, {}), /Scrie data/);
  store.finishTask(menu.inProgress[0].id, { date: future(365) });
  menu = store.menu();
  assert.equal(menu.inProgress.length, 0);
  assert.equal(menu.history.length, 1);
  assert.match(menu.history[0].result, /Valabil până la/);
  view = store.snapshot().view;
  assert.equal(view.lists.itp.length, 0);
  assert.equal(menu.acte[0].docs.itp.source, 'meniu');
});

test('taking a document back returns it to the to-do list', async () => {
  const { store } = tempStore();
  await store.importWorkbook(await upload(logistica([vehicle('B 1 AAA', 'FUNCTIONAL', { itp: soon() })])));
  store.takeDocument({ plate: 'B 1 AAA', doc: 'itp' });
  store.reopenTask(store.menu().inProgress[0].id);
  const menu = store.menu();
  assert.equal(menu.inProgress.length, 0);
  assert.equal(menu.documents.length, 1);
  assert.equal(menu.history.length, 0);
});

test('a problem added by hand goes through the same steps', async () => {
  const { store } = tempStore();
  await store.importWorkbook(await upload(logistica([vehicle('B 1 AAA', 'FUNCTIONAL')])));

  assert.throws(() => store.addTask({ plate: 'B 1 AAA', title: '  ' }), /ce e de rezolvat/);
  assert.throws(() => store.addTask({ title: 'x'.repeat(201) }), /prea lung/);
  assert.throws(() => store.addTask({ title: 'Frâne', due: 'mâine' }), /nu e o dată/);

  store.addTask({ plate: 'b 1 aaa', title: 'Frâne', urgent: true });
  let view = store.snapshot().view;
  assert.deepEqual(view.problems.map((p) => [p.plate, p.title, p.urgent, p.label]), [['B 1 AAA', 'Frâne', true, 'MAN TGX']]);

  const { id } = store.menu().problems[0];
  store.startTask(id, { responsible: 'Ana' });
  view = store.snapshot().view;
  assert.equal(view.problems.length, 0);
  assert.equal(view.work[0].responsible, 'Ana');

  store.reopenTask(id);
  assert.equal(store.menu().problems.length, 1, 'back on the list, not lost');

  store.finishTask(id, {});
  assert.equal(store.menu().history[0].title, 'Frâne');
  assert.throws(() => store.deleteTask(id), /deschise/);

  store.addTask({ title: 'Greșeală' });
  store.deleteTask(store.menu().problems[0].id);
  assert.equal(store.menu().problems.length, 0);
  assert.throws(() => store.startTask('nu-exista', {}), /nu mai există/);
});

test('the newest date wins between the Excel and the laptop', async () => {
  const { store } = tempStore();
  await store.importWorkbook(await upload(logistica([vehicle('B 1 AAA', 'FUNCTIONAL', { itp: excelDate(2026, 10, 1) })])));

  assert.throws(() => store.resolveDocument({ plate: 'B 1 AAA', doc: 'itp', date: '2026-09-01' }), /deja o dată/);
  assert.throws(() => store.resolveDocument({ plate: 'B 1 AAA', doc: 'nimic', date: '2030-01-01' }), /necunoscut/);
  assert.throws(() => store.resolveDocument({ plate: 'NU EXISTA', doc: 'itp', date: '2030-01-01' }), /nu e în listă/);

  store.resolveDocument({ plate: 'B 1 AAA', doc: 'itp', date: '2030-01-01' });
  const date = () => store.menu().acte[0].docs.itp;
  assert.equal(date().iso, '2030-01-01');

  // An older Excel doesn't undo the renewal entered at the laptop...
  await store.importWorkbook(await upload(logistica([vehicle('B 1 AAA', 'FUNCTIONAL', { itp: excelDate(2026, 10, 1) })])));
  assert.equal(date().iso, '2030-01-01');
  assert.equal(date().source, 'meniu');

  // ...a newer one takes over, and from then on the Excel decides again.
  await store.importWorkbook(await upload(logistica([vehicle('B 1 AAA', 'FUNCTIONAL', { itp: excelDate(2031, 1, 1) })])));
  assert.equal(date().iso, '2031-01-01');
  assert.equal(date().source, 'excel');
  await store.importWorkbook(await upload(logistica([vehicle('B 1 AAA', 'FUNCTIONAL', { itp: excelDate(2029, 1, 1) })])));
  assert.equal(date().iso, '2029-01-01');
});

test('a service date can be entered at the laptop, though the Excel has none', async () => {
  const { store } = tempStore();
  await store.importWorkbook(await upload(logistica([vehicle('B 1 AAA', 'FUNCTIONAL')])));
  assert.equal(store.menu().acte[0].docs.revizie.date, null);
  store.resolveDocument({ plate: 'B 1 AAA', doc: 'revizie', date: future(3) });
  const view = store.snapshot().view;
  assert.deepEqual(view.lists.alte.map((i) => [i.docName, i.level]), [['Revizie', 'urgent']]);
});

test('"does not apply" takes a document off every list, and can be undone', async () => {
  const { store } = tempStore();
  await store.importWorkbook(await upload(logistica([vehicle('B 1 AAA', 'FUNCTIONAL', { rovinieta: excelDate(2020, 1, 1) })])));
  assert.equal(store.snapshot().view.totals.expired, 1);

  store.takeDocument({ plate: 'B 1 AAA', doc: 'rovinieta' });
  store.setNotApplicable({ plate: 'B 1 AAA', doc: 'rovinieta', value: true });
  assert.equal(store.snapshot().view.totals.expired, 0);
  assert.equal(store.menu().documents.length, 0);
  assert.equal(store.menu().inProgress.length, 0);
  assert.equal(store.menu().acte[0].docs.rovinieta.notApplicable, true);

  store.setNotApplicable({ plate: 'B 1 AAA', doc: 'rovinieta', value: false });
  assert.equal(store.snapshot().view.totals.expired, 1);
});

test('every change tells the monitors, and only after it is saved', async () => {
  const { dir, store } = tempStore();
  const seen = [];
  const unsubscribe = store.subscribe(() => {
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'stare.json'), 'utf8'));
    seen.push(saved.tasks.length);
  });

  await store.importWorkbook(await upload(logistica([vehicle('B 1 AAA', 'FUNCTIONAL', { itp: soon(), rca: soon() })])));
  assert.equal(seen.length, 1, 'an import');

  store.addTask({ plate: 'B 1 AAA', title: 'Frâne' });
  assert.deepEqual(seen.slice(1), [1], 'the file already holds the new task when the monitors hear about it');
  const problem = store.menu().problems[0].id;
  store.startTask(problem, {});
  store.reopenTask(problem);
  store.finishTask(problem, {});
  store.takeDocument({ plate: 'B 1 AAA', doc: 'itp' });
  store.finishTask(store.menu().inProgress[0].id, { date: future(365) });
  store.resolveDocument({ plate: 'B 1 AAA', doc: 'rca', date: future(365) });
  store.setNotApplicable({ plate: 'B 1 AAA', doc: 'rovinieta', value: true });
  store.addTask({ title: 'De șters' });
  store.deleteTask(store.menu().problems[0].id);
  assert.equal(seen.length, 11, 'every action, once');

  assert.throws(() => store.addTask({ title: '' }));
  assert.equal(seen.length, 11, 'a refused change is not a change');

  unsubscribe();
  store.addTask({ title: 'După plecare' });
  assert.equal(seen.length, 11);
});

test('everything survives a restart, and a broken file is set aside, not overwritten', async () => {
  const { dir, store } = tempStore();
  await store.importWorkbook(await upload(logistica([vehicle('B 1 AAA', 'FUNCTIONAL', { itp: soon() })])));
  store.addTask({ plate: 'B 1 AAA', title: 'Frâne' });
  store.takeDocument({ plate: 'B 1 AAA', doc: 'itp' });

  const restarted = createMecanizareStore(CFG, dir);
  assert.equal(restarted.menu().problems.length, 1);
  assert.equal(restarted.menu().inProgress.length, 1);
  assert.equal(restarted.snapshot().view.fleetTotal, 1);

  const log = console.error;
  console.error = () => {};
  fs.writeFileSync(path.join(dir, 'stare.json'), '{ stricat');
  const afterCrash = createMecanizareStore(CFG, dir);
  console.error = log;
  assert.equal(afterCrash.menu().problems.length, 0);
  assert.ok(fs.readdirSync(dir).some((name) => name.startsWith('stare.json.stricat-')));
});
