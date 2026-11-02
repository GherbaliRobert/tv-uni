import { esc, icon, plate, count, fmtDate, fmtDuration, fmtShortDate, fmtNumber, now, remPx } from './util.js';

const LEVELS = {
  expired: { icon: 'x' },
  urgent: { icon: 'alert' },
  soon: { icon: 'clock' },
};

const LIST_NAMES = { itp: 'ITP', rca: 'RCA', tahograf: 'Tahograf', rovinieta: 'Rov.', revizii: 'Revizii' };

const WORK_ROW_REM = 6.1;
const DOC_ROW_REM = 3.05;
const PAGE_FLIP_MS = 20000;

const panels = {
  work: { rowRem: WORK_ROW_REM, items: [], page: 0, render: workRow },
  rovinieta: { rowRem: DOC_ROW_REM, items: [], page: 0, render: docRow },
  itp: { rowRem: DOC_ROW_REM, items: [], page: 0, render: docRow },
  rca: { rowRem: DOC_ROW_REM, items: [], page: 0, render: docRow },
  tahograf: { rowRem: DOC_ROW_REM, items: [], page: 0, render: docRow },
  revizii: { rowRem: DOC_ROW_REM, items: [], page: 0, render: revizieRow },
};

let cfg;
let pageTimer;

export function initMecanizare(appConfig) {
  cfg = appConfig;
}

function badge(level, text) {
  return `<span class="badge badge--${level}">${icon(LEVELS[level].icon)}${esc(text)}</span>`;
}

function daysText(days) {
  if (days < 0) return `expirat ${count(-days, 'zi', 'zile')}`;
  if (days === 0) return 'expiră azi';
  if (days === 1) return 'expiră mâine';
  return `în ${count(days, 'zi', 'zile')}`;
}

function docRow(item) {
  return `<div class="doc-row">
    ${plate(item.plate)}
    <span class="type">${esc(item.type)}</span>
    <span class="when">${esc(fmtDate(item.date))}</span>
    ${badge(item.level, daysText(item.days))}
  </div>`;
}

function revizieRow(item) {
  if (item.date !== null) return docRow(item);
  const left = item.counterLeft;
  const text = left <= 0
    ? `depășit ${fmtNumber(-left)} ${item.unit}`
    : `mai sunt ${fmtNumber(left)} ${item.unit}`;
  return `<div class="doc-row">
    ${plate(item.plate)}
    <span class="type">${esc(item.type)}</span>
    <span class="when">${esc(fmtNumber(item.counterDue))} ${esc(item.unit)}</span>
    ${badge(item.level, text)}
  </div>`;
}

function statusTag(status) {
  if (!status) return '';
  const key = status.toLowerCase();
  if (key.includes('piese')) return `<span class="tag tag--wait">${icon('pause')}${esc(status)}</span>`;
  if (key.includes('finaliz')) return `<span class="tag tag--done">${icon('check')}${esc(status)}</span>`;
  return `<span class="tag">${esc(status)}</span>`;
}

function dueText(work) {
  if (work.dueDays === null) return '<span class="work-due">fără termen</span>';
  if (work.dueDays < 0) {
    return `<span class="work-due work-due--late">${icon('alert')} termen depășit cu ${esc(count(-work.dueDays, 'zi', 'zile'))}</span>`;
  }
  if (work.dueDays === 0) return '<span class="work-due">termen: azi</span>';
  if (work.dueDays === 1) return '<span class="work-due">termen: mâine</span>';
  return `<span class="work-due">termen: ${esc(fmtShortDate(work.due))}</span>`;
}

function workRow(work) {
  const vehicle = [work.type, work.model].filter(Boolean).join(' · ');
  const meta = [
    work.mechanic,
    work.location,
    work.since ? `intrat de ${fmtDuration(now() - work.since)}` : null,
  ].filter(Boolean).join(' · ');
  return `<div class="work-row">
    <div class="work-who">${plate(work.plate)}<span class="type">${esc(vehicle)}</span></div>
    <div class="work-tags">${work.urgent ? '<span class="tag tag--urgent">Urgent</span>' : ''}${statusTag(work.status)}</div>
    <div class="work-job">${esc(work.job)}</div>
    <div class="work-meta">${esc(meta)}</div>
    ${dueText(work)}
  </div>`;
}

function emptyLine(key, known) {
  if (known === undefined) return ''; // Nothing loaded yet, so nothing to claim.
  if (!known) return `<div class="empty-line empty-line--nodata">${icon('file')}Nu sunt date în Excel</div>`;
  const text = key === 'work' ? 'Nicio mașină în lucru' : `Nimic scadent în următoarele ${cfg.zileAtentie} de zile`;
  return `<div class="empty-line">${icon('check')}${text}</div>`;
}

function renderPanel(key) {
  const panel = panels[key];
  const body = document.getElementById(`body-${key}`);
  const pager = document.getElementById(`pager-${key}`);
  if (!panel.items.length) {
    body.innerHTML = emptyLine(key, panel.known);
    pager.textContent = '';
    return;
  }
  const perPage = Math.max(1, Math.floor(body.clientHeight / (panel.rowRem * remPx())));
  const pages = Math.ceil(panel.items.length / perPage);
  panel.pages = pages;
  panel.page = Math.min(panel.page, pages - 1);
  const start = panel.page * perPage;
  body.innerHTML = panel.items.slice(start, start + perPage).map(panel.render).join('');
  pager.textContent = pages > 1 ? `${panel.page + 1} / ${pages}` : '';
}

const renderAll = () => Object.keys(panels).forEach(renderPanel);

function nextPages() {
  for (const [key, panel] of Object.entries(panels)) {
    if ((panel.pages || 1) > 1) {
      panel.page = (panel.page + 1) % panel.pages;
      renderPanel(key);
    }
  }
}

// Each visit starts at the most urgent page, unless the list is too long to get
// through in one visit: then it carries on, so the last pages are still shown.
export function startPaging(visibleMs) {
  for (const panel of Object.values(panels)) {
    if ((panel.pages || 1) * PAGE_FLIP_MS <= visibleMs) panel.page = 0;
  }
  renderAll();
  clearInterval(pageTimer);
  pageTimer = setInterval(nextPages, PAGE_FLIP_MS);
}

export function stopPaging() {
  clearInterval(pageTimer);
}

function breakdown(view, level) {
  const parts = Object.entries(LIST_NAMES)
    .filter(([key]) => view.counts[key][level] > 0)
    .map(([key, name]) => `${name} ${view.counts[key][level]}`);
  return parts.join(' · ') || 'nimic';
}

function kpi(tone, value, label, sub, ic = '') {
  return `<div class="kpi kpi--${tone}">
    <div class="kpi-value">${ic ? icon(ic) : ''}${value}</div>
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-sub">${esc(sub)}</div>
  </div>`;
}

function renderKpis(view) {
  const { totals, fleetTotal, available, overdueWork, work, known, pendingPlates, pendingCount, doneCount } = view;
  const waiting = work.filter((w) => (w.status || '').toLowerCase().includes('piese')).length;
  const availability = fleetTotal ? Math.round((available / fleetTotal) * 100) : 0;
  const workSub = [
    overdueWork ? `${overdueWork} cu termen depășit` : 'toate în termen',
    waiting ? `${waiting} așteaptă piese` : null,
  ].filter(Boolean).join(' · ');

  document.getElementById('kpis').innerHTML = [
    known.work
      ? kpi('accent', work.length, 'În lucru acum', workSub, 'wrench')
      : kpi('neutral', '—', 'În lucru acum', 'nu sunt date în Excel'),
    fleetTotal
      ? kpi('neutral', `${available}<small>/${fleetTotal}</small>`, 'Disponibile', `${availability}% din flotă`)
      : kpi('neutral', pendingPlates, 'Mașini vizate', `${count(pendingCount, 'document', 'documente')} · ${count(doneCount, 'realizat', 'realizate')}`),
    kpi(totals.expired ? 'crit' : 'good', totals.expired, 'Expirate', breakdown(view, 'expired'), totals.expired ? 'x' : 'check'),
    kpi(totals.urgent ? 'serious' : 'good', totals.urgent, `Expiră în ${cfg.zileUrgent} zile`, breakdown(view, 'urgent'), totals.urgent ? 'alert' : 'check'),
    kpi(totals.soon ? 'warn' : 'good', totals.soon, `Expiră în ${cfg.zileUrgent + 1}–${cfg.zileAtentie} zile`, breakdown(view, 'soon'), totals.soon ? 'clock' : 'check'),
  ].join('');
}

function renderCounts(key, counts) {
  const parts = Object.keys(LEVELS)
    .filter((level) => counts[level] > 0)
    .map((level) => `<span class="count count--${level}">${icon(LEVELS[level].icon)}${counts[level]}</span>`);
  document.getElementById(`counts-${key}`).innerHTML = parts.join('');
}

export function renderMecanizare(data) {
  const emptyEl = document.getElementById('mec-empty');
  const warningsEl = document.getElementById('mec-warnings');

  if (!data.view) {
    emptyEl.hidden = false;
    emptyEl.innerHTML = `${icon('file')}<h2>Datele de mecanizare nu sunt disponibile</h2><p>${esc(data.error || 'Se încarcă...')}</p><p>Încarcă Excelul de pe calculator, la adresa /incarca.</p>`;
    return;
  }
  emptyEl.hidden = true;

  const { view } = data;
  renderKpis(view);
  panels.work.items = view.work;
  panels.work.known = view.known.work;
  for (const key of Object.keys(LIST_NAMES)) {
    panels[key].items = view.lists[key];
    panels[key].known = view.known[key];
    renderCounts(key, view.counts[key]);
  }

  warningsEl.hidden = !data.warnings.length;
  warningsEl.innerHTML = data.warnings.length
    ? `${icon('alert')}<span>Excel: ${esc(count(data.warnings.length, 'problemă', 'probleme'))} — ${esc(data.warnings.slice(0, 2).join('; '))}</span>`
    : '';

  renderAll();
}
