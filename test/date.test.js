process.env.TZ = 'Europe/Bucharest';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { daysBetween, isoWeek, weekBounds, parseDate } = require('../src/dates');
const { classify, recordSpeed } = require('../src/gps/tracker');
const { createMecanizareStore, UploadError, parseWorkbook, parseExpiries, mergeSources, buildView } = require('../src/mecanizare');

const CFG = {
  zileUrgent: 7, zileAtentie: 30, kmUrgent: 1000, kmAtentie: 5000, oreUrgent: 25, oreAtentie: 100,
};
const GPS = {
  faraSemnalMinutePornit: 15, faraSemnalOreOprit: 24, vitezaMinimaMiscare: 5, vitezaMaximaPlauzibila: 180,
};

const FLEET_HEADER = ['Nr. înmatriculare', 'Tip', 'Marcă / Model', 'Rovinietă expiră', 'ITP expiră', 'RCA expiră',
  'Revizie scadentă - dată', 'Revizie scadentă - contor', 'Contor actual', 'Unitate contor'];
const WORK_HEADER = ['Nr. înmatriculare', 'Lucrare', 'Mecanic', 'Loc', 'Intrare', 'Termen estimat', 'Stare', 'Prioritate'];

function workbook(fleetRows, workRows = []) {
  const wb = new ExcelJS.Workbook();
  const fleet = wb.addWorksheet('Flota');
  fleet.addRow(FLEET_HEADER);
  fleet.addRows(fleetRows);
  const work = wb.addWorksheet('In lucru');
  work.addRow(WORK_HEADER);
  work.addRows(workRows);
  return wb;
}

test('parseDate reads the formats people actually type', () => {
  assert.deepEqual(parseDate('15.11.2026'), new Date(2026, 10, 15));
  assert.deepEqual(parseDate('15/11/26'), new Date(2026, 10, 15));
  assert.deepEqual(parseDate('2026-11-15'), new Date(2026, 10, 15));
  assert.deepEqual(parseDate('15.11.2026 08:30'), new Date(2026, 10, 15, 8, 30));
});

test('parseDate rejects impossible dates instead of rolling them over', () => {
  assert.equal(parseDate('31.02.2026'), null);
  assert.equal(parseDate('15.13.2026'), null);
  assert.equal(parseDate('curând'), null);
});

test('parseDate keeps the wall-clock of real Excel dates', () => {
  assert.deepEqual(parseDate(new Date(Date.UTC(2026, 10, 15, 8, 30))), new Date(2026, 10, 15, 8, 30));
  assert.deepEqual(parseDate(46341), new Date(2026, 10, 15));
});

test('daysBetween survives the daylight-saving change', () => {
  assert.equal(daysBetween(new Date(2026, 9, 24, 23, 0), new Date(2026, 9, 26, 1, 0)), 2);
  assert.equal(daysBetween(new Date(2026, 10, 2, 23, 59), new Date(2026, 10, 2, 0, 1)), 0);
});

test('week is Monday to Sunday with the ISO number', () => {
  const sunday = new Date(2026, 10, 8, 23, 0);
  assert.deepEqual(isoWeek(new Date(2026, 10, 2)), { year: 2026, week: 45 });
  assert.deepEqual(isoWeek(sunday), { year: 2026, week: 45 });
  assert.deepEqual(weekBounds(sunday).start, new Date(2026, 10, 2));
  assert.deepEqual(weekBounds(sunday).end, new Date(2026, 10, 9));
});

test('classify separates moving, idling, off and silent vehicles', () => {
  const now = Date.now();
  const position = (speed, ignition, ageMinutes = 0) => ({ speed, ignition, timestamp: now - ageMinutes * 60000 });
  assert.equal(classify(position(60, true), now, GPS), 'moving');
  assert.equal(classify(position(2, true), now, GPS), 'idle');
  assert.equal(classify(position(0, false), now, GPS), 'off');
  assert.equal(classify(position(60, true, 16), now, GPS), 'nosignal');
  // A parked tracker reports rarely: a few hours of silence with the ignition off is normal.
  assert.equal(classify(position(0, false, 300), now, GPS), 'off');
  assert.equal(classify(position(0, false, 25 * 60), now, GPS), 'nosignal');
});

test('recordSpeed keeps the weekly maximum and ignores GPS spikes and old data', () => {
  const week = { maxes: {} };
  const now = Date.now();
  assert.equal(recordSpeed(week, { plate: 'A', speed: 90, at: now }, GPS), true);
  assert.equal(recordSpeed(week, { plate: 'A', speed: 70, at: now }, GPS), false);
  assert.equal(recordSpeed(week, { plate: 'A', speed: 250, at: now }, GPS), false);
  assert.equal(recordSpeed(week, { plate: 'A', speed: 120, at: now - 9 * 86400000 }, GPS), false);
  assert.equal(week.maxes.A.speed, 90);
});

test('buildView sorts by urgency and leaves out what is far away or does not apply', () => {
  const data = parseWorkbook(workbook([
    ['AA', 'Camion', 'X', '30.10.2026', null, null],
    ['BB', 'Camion', 'X', '05.11.2026', null, null],
    ['CC', 'Camion', 'X', '20.11.2026', null, null],
    ['DD', 'Camion', 'X', '20.03.2027', null, null],
    ['EE', 'Excavator', 'X', null, null, null],
  ]));
  const view = buildView(data, new Date(2026, 10, 2).getTime(), CFG);
  assert.deepEqual(view.lists.rovinieta.map((i) => [i.plate, i.days, i.level]), [
    ['AA', -3, 'expired'],
    ['BB', 3, 'urgent'],
    ['CC', 18, 'soon'],
  ]);
  assert.deepEqual(view.totals, { expired: 1, urgent: 1, soon: 1 });
  assert.equal(view.fleetTotal, 5);
});

test('a document expiring today is urgent, not expired', () => {
  const data = parseWorkbook(workbook([['AA', 'Camion', 'X', '02.11.2026']]));
  const view = buildView(data, new Date(2026, 10, 2, 18, 0).getTime(), CFG);
  assert.deepEqual(view.lists.rovinieta.map((i) => [i.days, i.level]), [[0, 'urgent']]);
});

test('revizii use km or engine hours, whichever is more urgent', () => {
  const data = parseWorkbook(workbook([
    ['KM', 'Camion', 'X', null, null, null, null, 100000, 99500, 'km'],
    ['ORE', 'Excavator', 'X', null, null, null, null, 2500, 2480, 'ore'],
    ['DEPASIT', 'Camion', 'X', null, null, null, null, 100000, 100450, 'km'],
    ['BOTH', 'Camion', 'X', null, null, null, '20.11.2026', 200000, 199900, 'km'],
    ['OK', 'Camion', 'X', null, null, null, '20.11.2027', 200000, 150000, 'km'],
  ]));
  const { revizii } = buildView(data, new Date(2026, 10, 2).getTime(), CFG).lists;
  const byPlate = Object.fromEntries(revizii.map((r) => [r.plate, r]));
  assert.equal(byPlate.DEPASIT.level, 'expired');
  assert.equal(byPlate.DEPASIT.counterLeft, -450);
  assert.equal(byPlate.KM.level, 'urgent');
  assert.equal(byPlate.ORE.level, 'urgent');
  assert.equal(byPlate.ORE.unit, 'ore');
  assert.equal(byPlate.BOTH.level, 'urgent');
  assert.equal(byPlate.BOTH.counterLeft, 100);
  assert.equal(byPlate.OK, undefined);
});

test('unreadable cells become warnings; the rest of the row still counts', () => {
  const data = parseWorkbook(workbook([['AA', 'Camion', 'X', 'poate luni', '05.11.2026']]));
  assert.equal(data.warnings.length, 1);
  assert.match(data.warnings[0], /rândul 2.*poate luni.*AA/);
  const view = buildView(data, new Date(2026, 10, 2).getTime(), CFG);
  assert.equal(view.lists.itp.length, 1);
  assert.equal(view.lists.rovinieta.length, 0);
});

test('work list puts urgent and overdue first and reduces availability', () => {
  const data = parseWorkbook(workbook(
    [['B-1-AA', 'Camion', 'MAN'], ['B-2-AA', 'Camion', 'MAN'], ['B-3-AA', 'Camion', 'MAN']],
    [
      ['b 1 aa', 'Normal in termen', 'M', 'Atelier', '01.11.2026', '10.11.2026', 'În lucru', 'Normal'],
      ['B-2-AA', 'Depasit', 'M', 'Atelier', '20.10.2026', '30.10.2026', 'În lucru', 'Normal'],
      ['NECUNOSCUT', 'Urgent', 'M', 'Atelier', '02.11.2026', '12.11.2026', 'În lucru', 'Urgent'],
    ],
  ));
  const view = buildView(data, new Date(2026, 10, 2).getTime(), CFG);
  assert.deepEqual(view.work.map((w) => w.job), ['Urgent', 'Depasit', 'Normal in termen']);
  assert.equal(view.work[2].type, 'Camion', 'plate formatting differences still match the fleet');
  assert.equal(view.overdueWork, 1);
  assert.equal(view.available, 1, 'only fleet vehicles count against availability');
});

test('missing sheets and columns are reported, not silently ignored', () => {
  assert.throws(() => parseWorkbook(new ExcelJS.Workbook()), /Flota/);
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Flota').addRow(['Nr. înmatriculare', 'Tip']);
  wb.addWorksheet('In lucru').addRow(WORK_HEADER);
  assert.ok(parseWorkbook(wb).warnings.some((w) => /lipsește coloana „itp expira”/.test(w)));
});

// Same shape as the real file: repeated title cells, and Realizat named only in the first header.
function centralizer(rows) {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Expirări 2026').addRows(rows);
  return wb;
}
const TITLE = ['CENTRALIZATOR EXPIRĂRI', 'CENTRALIZATOR EXPIRĂRI', 'CENTRALIZATOR EXPIRĂRI'];
const FIRST_HEADER = ['NUMĂR AUTO', 'DATA EXPIRĂRII', 'STATUS', 'REALIZAT'];
const HEADER = ['NUMĂR AUTO', 'DATA EXPIRĂRII', 'STATUS'];
const excelDate = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const NOV_2 = new Date(2026, 10, 2).getTime();

test('parseExpiries reads each block and carries the Realizat column over', () => {
  const { lists, warnings } = parseExpiries(centralizer([
    TITLE,
    ['ITP', 'ITP', 'ITP'],
    FIRST_HEADER,
    ['B 11 AAA', excelDate(2026, 11, 11), 'VA EXPIRA', '🔲'],
    ['B 12 AAA', excelDate(2026, 11, 12), 'VA EXPIRA', '✅'],
    [],
    ['RCA', 'RCA', 'RCA'],
    HEADER,
    ['B 13 AAA', excelDate(2026, 11, 20), 'VA EXPIRA', '☑️'],
    [],
    ['TAHOGRAF', 'TAHOGRAF', 'TAHOGRAF'],
    HEADER,
    ['B 13 AAA', '29.11.2026', 'VA EXPIRA', '🔲'],
    [],
    ['ROVINIETĂ', 'ROVINIETĂ', 'ROVINIETĂ'],
    HEADER,
    ['B 14 AAA', excelDate(2026, 11, 27), 'VA EXPIRA'],
  ]));
  assert.deepEqual(warnings, []);
  assert.deepEqual(Object.keys(lists), ['itp', 'rca', 'tahograf', 'rovinieta']);
  assert.deepEqual(lists.itp.map((r) => [r.plate, r.done]), [['B 11 AAA', false], ['B 12 AAA', true]]);
  assert.equal(lists.rca[0].done, true, 'emoji with a variation selector still counts');
  assert.equal(lists.rovinieta[0].done, false, 'an empty cell means not done');
  assert.deepEqual(lists.tahograf[0].date, new Date(2026, 10, 29));
  assert.deepEqual(lists.itp[0].date, new Date(2026, 10, 11));
});

test('parseExpiries never hides or misfiles what it cannot read', () => {
  const { lists, warnings } = parseExpiries(centralizer([
    ['ITP', 'ITP', 'ITP'],
    FIRST_HEADER,
    ['B 1 AA', excelDate(2026, 11, 11), 'VA EXPIRA', 'poate'],
    ['B 2 AA', '31.02.2026', 'VA EXPIRA', '🔲'],
    ['CASCO', 'CASCO', 'CASCO'],
    HEADER,
    ['B 3 AA', excelDate(2026, 11, 11), 'VA EXPIRA', '🔲'],
    ['RCA'],
    HEADER,
    ['B 4 AA', excelDate(2026, 11, 11), 'VA EXPIRA', '🔲'],
    ['ALTCEVA'],
    HEADER,
    ['B 5 AA', excelDate(2026, 11, 11), 'VA EXPIRA', '🔲'],
  ]));
  assert.equal(lists.itp[0].done, false, 'an unknown mark stays on the list');
  assert.deepEqual(lists.itp.map((r) => r.plate), ['B 1 AA'], 'bad date and unknown block are not filed under ITP');
  assert.deepEqual(lists.rca.map((r) => r.plate), ['B 4 AA'], 'a block with no known title is not filed under RCA');
  assert.ok(warnings.some((w) => /Realizat/.test(w)));
  assert.ok(warnings.some((w) => /rândul 4.*B 2 AA/.test(w)));
  assert.ok(warnings.some((w) => /CASCO/.test(w)));
  assert.throws(() => parseExpiries(centralizer([['ceva'], ['altceva']])), /blocurile/);
});

test('the view hides done documents and separates "nothing due" from "no data"', () => {
  const expiries = parseExpiries(centralizer([
    ['ITP'], FIRST_HEADER,
    ['B 1 AA', excelDate(2026, 11, 3), 'VA EXPIRA', '🔲'],
    ['B 2 AA', excelDate(2026, 11, 20), 'VA EXPIRA', '✅'],
    ['B 3 AA', excelDate(2026, 10, 30), 'VA EXPIRA', '🔲'],
    ['RCA'], HEADER,
    ['B 1 AA', excelDate(2026, 11, 20), 'VA EXPIRA', '🔲'],
    ['TAHOGRAF'], HEADER,
    ['B 9 AA', excelDate(2026, 11, 20), 'VA EXPIRA', '✅'],
  ]));
  const view = buildView(mergeSources(null, expiries), NOV_2, CFG);
  assert.deepEqual(view.lists.itp.map((i) => [i.plate, i.level]), [['B 3 AA', 'expired'], ['B 1 AA', 'urgent']]);
  assert.deepEqual(view.lists.tahograf, []);
  assert.equal(view.known.tahograf, true, 'all done is a real "nothing due"');
  assert.equal(view.known.rovinieta, false, 'a block missing from the file is unknown');
  assert.equal(view.known.work, false);
  assert.equal(view.known.revizii, false);
  assert.equal(view.pendingCount, 3);
  assert.equal(view.pendingPlates, 2, 'a plate with two documents is one vehicle');
  assert.equal(view.doneCount, 2);
});

test('demo workshop rows never sit next to real expiries', () => {
  const expiries = parseExpiries(centralizer([['ITP'], FIRST_HEADER, ['B 1 AA', excelDate(2026, 11, 20), 'VA EXPIRA', '🔲']]));
  const workshop = () => parseWorkbook(workbook(
    [['B 1 AA', 'Camion', 'MAN', '03.11.2026', '03.11.2026', '03.11.2026', '03.11.2026']],
    [['B-9-AA', 'Lucrare', 'M', 'Atelier', '01.11.2026', '10.11.2026', 'În lucru', 'Normal']],
  ));

  const demo = mergeSources({ ...workshop(), demo: true }, expiries);
  assert.equal(demo.demo, false);
  assert.deepEqual(demo.work, []);
  assert.deepEqual(demo.fleet, []);

  const view = buildView(mergeSources(workshop(), expiries), NOV_2, CFG);
  assert.equal(view.known.work, true);
  assert.equal(view.work.length, 1);
  assert.equal(view.lists.revizii.length, 1, 'real workshop file still supplies revizii');
  assert.deepEqual(view.lists.itp.map((i) => [i.days, i.type]), [[18, 'Camion']], 'the centralizer wins over fleet dates');
  assert.deepEqual(view.lists.rca, [], 'fleet dates are ignored once the centralizer is loaded');

  assert.equal(mergeSources({ ...workshop(), demo: true }, null).demo, true, 'alone, the demo file still runs and is labelled');
  assert.equal(mergeSources(null, null), null);
});

test('a Revizii block in the centralizer fills the Revizii panel', () => {
  const expiries = parseExpiries(centralizer([['REVIZII'], FIRST_HEADER, ['B 1 AA', excelDate(2026, 11, 5), 'VA EXPIRA', '🔲']]));
  const view = buildView(mergeSources(null, expiries), NOV_2, CFG);
  assert.equal(view.known.revizii, true);
  assert.deepEqual(view.lists.revizii.map((i) => [i.plate, i.level, i.days]), [['B 1 AA', 'urgent', 3]]);
});

test('an upload is checked before it replaces anything, and survives a restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panou-upload-'));
  const options = { fisier: 'mecanizare.xlsx', fisierExpirari: 'Centralizator_expirari_*.xlsx', verificareSecunde: 60, ...CFG };
  const store = createMecanizareStore(options, dir);
  const soon = new Date(Date.now() + 5 * 86400000);
  const upload = async (wb) => Buffer.from(await wb.xlsx.writeBuffer());

  const good = await store.saveUpload(await upload(centralizer([['ITP'], FIRST_HEADER, ['B 1 AA', soon, 'VA EXPIRA', '🔲'], ['RCA'], HEADER, ['B 1 AA', soon, 'VA EXPIRA', '🔲']])));
  assert.equal(good.kind, 'expirari');
  assert.equal(good.summary, 'ITP 1, RCA 1');
  assert.equal(store.snapshot().view.pendingCount, 2);

  await assert.rejects(store.saveUpload(Buffer.from('nu e excel')), (err) => err instanceof UploadError && /xlsx/.test(err.message));
  await assert.rejects(store.saveUpload(await upload(centralizer([['ceva'], ['altceva']]))), (err) => err instanceof UploadError && /blocurile/.test(err.message));
  assert.equal(store.snapshot().view.pendingCount, 2, 'a refused file changes nothing');
  assert.deepEqual(fs.readdirSync(dir), ['Centralizator_expirari_incarcat.xlsx']);

  const replaced = await store.saveUpload(await upload(centralizer([['ITP'], FIRST_HEADER, ['B 2 AA', soon, 'VA EXPIRA', '🔲']])));
  assert.equal(replaced.summary, 'ITP 1');
  assert.equal(store.snapshot().view.pendingCount, 1, 'a new upload replaces the previous one');

  const shop = await store.saveUpload(await upload(workbook(
    [['B 1 AA', 'Camion', 'MAN']],
    [['B 1 AA', 'Lucrare', 'M', 'Atelier', '01.11.2026', '10.11.2026', 'În lucru', 'Normal']],
  )));
  assert.equal(shop.kind, 'atelier');
  assert.equal(shop.summary, 'Flotă 1, în lucru 1');
  const view = store.snapshot().view;
  assert.equal(view.known.work, true);
  assert.equal(view.work.length, 1);
  assert.equal(view.pendingCount, 1, 'the expiries are still there');

  const restarted = createMecanizareStore(options, dir);
  await restarted.saveUpload(await upload(centralizer([['RCA'], FIRST_HEADER, ['B 3 AA', soon, 'VA EXPIRA', '🔲']])));
  assert.equal(restarted.snapshot().view.work.length, 1, 'files on the volume are read back after a restart');

  fs.rmSync(dir, { recursive: true, force: true });
});
