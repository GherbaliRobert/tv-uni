import { esc, icon, plate, count, expiryText, fmtDate, fmtDuration, fmtShortDate, now, remPx } from './util.js';

const LEVELS = {
  expired: { icon: 'x' },
  urgent: { icon: 'alert' },
  soon: { icon: 'clock' },
};

const LIST_NAMES = { itp: 'ITP', rca: 'RCA', rovinieta: 'Rov.', alte: 'Altele' };

const WORK_ROW_REM = 6.1;
const DOC_ROW_REM = 3.05;
const PAGE_FLIP_MS = 20000;

const panels = {
  work: { rowRem: WORK_ROW_REM, items: [], page: 0, render: workRow, empty: 'Nimic în curs' },
  problems: { rowRem: WORK_ROW_REM, items: [], page: 0, render: workRow, empty: 'Nicio problemă deschisă' },
  itp: { rowRem: DOC_ROW_REM, items: [], page: 0, render: docRow },
  rca: { rowRem: DOC_ROW_REM, items: [], page: 0, render: docRow },
  rovinieta: { rowRem: DOC_ROW_REM, items: [], page: 0, render: docRow },
  alte: { rowRem: DOC_ROW_REM, items: [], page: 0, render: otherDocRow },
};

let cfg;
let loaded = false;
let pageTimer;

export function initMecanizare(appConfig) {
  cfg = appConfig;
}

function badge(level, text) {
  return `<span class="badge badge--${level}">${icon(LEVELS[level].icon)}${esc(text)}</span>`;
}

function docRowWith(item, note) {
  const tag = item.inProgress ? '<span class="tag">în curs</span>' : `<span class="type">${esc(note)}</span>`;
  return `<div class="doc-row">
    ${plate(item.plate)}
    ${tag}
    <span class="when">${esc(fmtDate(item.date))}</span>
    ${badge(item.level, expiryText(item.days))}
  </div>`;
}

function docRow(item) {
  return docRowWith(item, item.working ? item.label : item.status);
}

function otherDocRow(item) {
  return docRowWith(item, item.working ? item.docName : `${item.docName}, ${item.status}`);
}

function dueText(task) {
  if (task.dueDays === null) return '<span class="work-due">fără termen</span>';
  if (task.dueDays < 0) {
    return `<span class="work-due work-due--late">${icon('alert')} termen depășit cu ${esc(count(-task.dueDays, 'zi', 'zile'))}</span>`;
  }
  if (task.dueDays === 0) return '<span class="work-due">termen: azi</span>';
  if (task.dueDays === 1) return '<span class="work-due">termen: mâine</span>';
  return `<span class="work-due">termen: ${esc(fmtShortDate(task.due))}</span>`;
}

function workRow(task) {
  const since = task.startedAt || task.createdAt;
  const meta = [task.responsible, task.location, `de ${fmtDuration(now() - since)}`].filter(Boolean).join(' · ');
  return `<div class="work-row">
    <div class="work-who">${task.plate ? plate(task.plate) : ''}<span class="type">${esc(task.label)}</span></div>
    <div class="work-tags">${task.urgent ? '<span class="tag tag--urgent">Urgent</span>' : ''}</div>
    <div class="work-job">${esc(task.title)}</div>
    <div class="work-meta">${esc(meta)}</div>
    ${dueText(task)}
  </div>`;
}

function emptyLine(panel) {
  if (!loaded) return ''; // Nothing loaded yet, so nothing to claim.
  const text = panel.empty || `Nimic scadent în următoarele ${cfg.zileAtentie} de zile`;
  return `<div class="empty-line">${icon('check')}${esc(text)}</div>`;
}

function renderPanel(key) {
  const panel = panels[key];
  const body = document.getElementById(`body-${key}`);
  const pager = document.getElementById(`pager-${key}`);
  if (!panel.items.length) {
    body.innerHTML = emptyLine(panel);
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

// With the GPS tab back, each visit starts at the most urgent page, unless the list is too
// long to get through in one visit: then it carries on, so the last pages are still shown.
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
  const { totals, overdueWork, work, problems, pendingDocuments } = view;
  const workSub = work.length ? (overdueWork ? `${overdueWork} cu termen depășit` : 'toate în termen') : 'nimic preluat';
  const pending = pendingDocuments + problems.length;

  document.getElementById('kpis').innerHTML = [
    kpi('accent', work.length, 'În curs', workSub, 'wrench'),
    kpi('neutral', pending, 'De rezolvat', `${count(pendingDocuments, 'act', 'acte')} · ${count(problems.length, 'problemă', 'probleme')}`),
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

  if (!data.view) {
    emptyEl.hidden = false;
    emptyEl.innerHTML = `${icon('file')}<h2>Nu sunt încă date</h2><p>Încarcă fișierul Logistica Auto din meniul de pe laptop.</p>`;
    return;
  }
  emptyEl.hidden = true;
  loaded = true;

  const { view } = data;
  renderKpis(view);
  panels.work.items = view.work;
  panels.problems.items = view.problems;
  for (const key of Object.keys(LIST_NAMES)) {
    panels[key].items = view.lists[key];
    renderCounts(key, view.counts[key]);
  }

  renderAll();
}
