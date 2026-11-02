// Creates date/mecanizare.xlsx with sample data and the expected columns.
// Refuses to overwrite an existing file unless called with --suprascrie.

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { DEMO_FLEET } = require('../src/gps/demo');

const OUTPUT = path.join(__dirname, '..', 'date', 'mecanizare.xlsx');

if (fs.existsSync(OUTPUT) && !process.argv.includes('--suprascrie')) {
  console.error(`Există deja ${OUTPUT}. Folosește --suprascrie dacă vrei să-l înlocuiești (datele din el se pierd).`);
  process.exit(1);
}

const MODELS = {
  Autobasculantă: 'MAN TGS 41.430',
  Autoutilitară: 'Ford Transit',
  Autoturism: 'Dacia Duster',
  Betonieră: 'Mercedes Arocs',
  'Cap tractor': 'Volvo FH',
  Excavator: 'Caterpillar 320',
  Buldoexcavator: 'JCB 3CX',
  'Cilindru compactor': 'Bomag BW 213',
};
const OFF_ROAD = new Set(['Excavator', 'Buldoexcavator', 'Cilindru compactor']);

// Excel dates hold wall-clock time; exceljs writes the UTC fields of the Date it receives.
function excelDate(daysFromToday, hour = 0, minute = 0) {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + daysFromToday, hour, minute));
}

// Days until expiry per vehicle, as a fixed pattern so a few of each urgency level show up.
const ROVINIETA = [-4, 3, 12, 25, 40, 90, 180, 300, 16, 150, 70, 210, 28, 6, 120, 45, 60, 260, 22, 330, 100, 8, 200, -1, 75, 140];
const ITP = [120, 18, 200, -2, 60, 5, 300, 90, 27, 240, 150, 11, 75, 330, 180, 2, 40, 100, 280, 55, 130, 24, 210, 85, 170, 13];
const RCA = [35, 250, 9, 140, 22, 310, -6, 65, 190, 14, 100, 270, 4, 80, 220, 29, 160, 50, 1, 340, 110, 19, 240, 95, 26, 175];
const REVIEW_DATE = [20, null, 75, null, 4, null, 130, null, -3, null, 45, null, 12, null, 90, null, 26, null, 160, null, 60, null, 6, null, 110, null, 15, null, 50, null, 28, null];
const REVIEW_LEFT = [null, 3200, null, 12000, null, -450, null, 800, null, 25000, null, 4100, null, 15000, null, 600, null, 9000, null, 2400, null, 30000, null, 7000, null, 1800, null, 60, null, 300, null, 80];

const fleetRows = DEMO_FLEET.map((vehicle, i) => {
  const offRoad = OFF_ROAD.has(vehicle.type);
  const unit = offRoad ? 'ore' : 'km';
  const counter = offRoad ? 2400 + i * 137 : 80000 + i * 7350;
  const left = REVIEW_LEFT[i];
  return [
    vehicle.plate,
    vehicle.type,
    MODELS[vehicle.type],
    offRoad ? null : excelDate(ROVINIETA[i]),
    offRoad ? null : excelDate(ITP[i]),
    offRoad ? null : excelDate(RCA[i]),
    REVIEW_DATE[i] === null ? null : excelDate(REVIEW_DATE[i]),
    left === null ? null : counter + left,
    left === null ? null : counter,
    unit,
  ];
});

const WORK_ROWS = [
  ['B-103-UTP', 'Înlocuire ambreiaj și volantă', 'Ion Marin', 'Atelier', excelDate(-3, 8, 15), excelDate(0), 'În lucru', 'Urgent'],
  ['B-501-UTP', 'Reparație sistem frânare pneumatic', 'Vasile Dobre', 'Atelier', excelDate(-1, 7, 40), excelDate(1), 'În lucru', 'Urgent'],
  ['EXC-02', 'Schimb furtunuri hidraulice braț', 'Marius Stan', 'Pe șantier', excelDate(0, 7, 30), excelDate(0), 'În lucru', 'Normal'],
  ['B-106-UTP', 'Turbosuflantă defectă', 'Ion Marin', 'Atelier', excelDate(-6, 9, 0), excelDate(-1), 'Așteaptă piese', 'Normal'],
  ['B-402-UTP', 'Reductor cuvă — zgomot la rotire', 'Service autorizat', 'Service extern', excelDate(-4, 11, 20), excelDate(3), 'Service extern', 'Normal'],
  ['B-202-UTP', 'Revizie completă și filtre', 'Andrei Pop', 'Atelier', excelDate(0, 8, 0), excelDate(0), 'Finalizare', 'Normal'],
  ['B-302-UTP', 'Înlocuire plăcuțe și discuri față', 'Andrei Pop', 'Atelier', excelDate(0, 9, 45), excelDate(1), 'În lucru', 'Normal'],
  ['BLD-01', 'Verificare instalație electrică', 'Marius Stan', 'Atelier', excelDate(-1, 13, 10), excelDate(2), 'Diagnoză', 'Normal'],
  ['IF-11-UTP', 'Reparație benă — sudură cadru', 'Vasile Dobre', 'Atelier', excelDate(-2, 10, 30), excelDate(4), 'În lucru', 'Normal'],
  ['B-107-UTP', 'Injectoare, proba pe stand', 'Service autorizat', 'Service extern', excelDate(-5, 8, 0), excelDate(-2), 'Așteaptă piese', 'Normal'],
];

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C5CAB' } };

function styleSheet(sheet, widths, dateColumns, dateFormat) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  widths.forEach((width, i) => { sheet.getColumn(i + 1).width = width; });
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 32;
  dateColumns.forEach((col) => { sheet.getColumn(col).numFmt = dateFormat; });
}

function listValidation(sheet, column, values, rows = 500) {
  for (let row = 2; row <= rows; row += 1) {
    sheet.getCell(`${column}${row}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      showErrorMessage: false,
      formulae: [`"${values.join(',')}"`],
    };
  }
}

async function main() {
  const workbook = new ExcelJS.Workbook();

  const info = workbook.addWorksheet('Citeste-ma');
  info.addRows([
    ['Panou TV mecanizare — date pentru fila „Mecanizare”'],
    [],
    ['Date demonstrative', 'DA'],
    [],
    ['Când treci pe date reale: înlocuiește rândurile din foile „Flota” și „In lucru”, apoi scrie NU în celula B3. Eticheta „DATE DEMO” dispare de pe televizor.'],
    ['Televizorul preia modificările singur, la câteva secunde după ce salvezi fișierul.'],
    [],
    ['Foaia „Flota”: câte un rând pentru fiecare mașină sau utilaj.'],
    ['Lasă celula goală dacă documentul nu se aplică (de exemplu rovinietă la excavator).'],
    ['Revizia se poate urmări după dată, după contor (km sau ore) sau după amândouă; se ia în calcul ce vine mai repede.'],
    [],
    ['Foaia „In lucru”: ce este acum în atelier sau în service. Șterge rândul când mașina a ieșit.'],
    ['Datele se pot scrie și ca text: 15.11.2026 sau 15.11.2026 08:30.'],
    ['Numele foilor și ale coloanelor nu se schimbă; ordinea coloanelor nu contează.'],
  ]);
  info.getColumn(1).width = 110;
  info.getColumn(2).width = 10;
  info.getCell('A1').font = { bold: true, size: 14 };
  info.getCell('A3').font = { bold: true };
  info.getCell('B3').font = { bold: true };

  const fleet = workbook.addWorksheet('Flota');
  fleet.addRow([
    'Nr. înmatriculare', 'Tip', 'Marcă / Model', 'Rovinietă expiră', 'ITP expiră', 'RCA expiră',
    'Revizie scadentă - dată', 'Revizie scadentă - contor', 'Contor actual', 'Unitate contor',
  ]);
  fleet.addRows(fleetRows);
  styleSheet(fleet, [17, 20, 20, 13, 13, 13, 14, 14, 12, 10], [4, 5, 6, 7], 'dd.mm.yyyy');
  fleet.getColumn(8).numFmt = '#,##0';
  fleet.getColumn(9).numFmt = '#,##0';
  listValidation(fleet, 'J', ['km', 'ore']);

  const work = workbook.addWorksheet('In lucru');
  work.addRow(['Nr. înmatriculare', 'Lucrare', 'Mecanic', 'Loc', 'Intrare', 'Termen estimat', 'Stare', 'Prioritate']);
  work.addRows(WORK_ROWS);
  styleSheet(work, [17, 44, 20, 16, 17, 13, 16, 11], [6], 'dd.mm.yyyy');
  work.getColumn(5).numFmt = 'dd.mm.yyyy hh:mm';
  listValidation(work, 'G', ['Diagnoză', 'În lucru', 'Așteaptă piese', 'Service extern', 'Finalizare']);
  listValidation(work, 'H', ['Normal', 'Urgent']);

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  await workbook.xlsx.writeFile(OUTPUT);
  console.log(`Creat: ${OUTPUT}`);
}

main();
