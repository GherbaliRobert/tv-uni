import { count, esc, expiryText, fmtDate, fmtDuration, fmtShortDate } from '/js/util.js';

const API = '/api/meniu';
const REFRESH_MS = 60000;
const TABS = {
  rezolvat: 'De rezolvat',
  curs: 'În curs',
  acte: 'Acte',
  istoric: 'Istoric',
  import: 'Import Excel',
};

const state = {
  tab: 'rezolvat',
  data: null,
  search: '',
  doc: '',
  level: '',
  acteFilter: '',
};

const view = document.getElementById('view');
const notice = document.getElementById('notice');
const dialog = document.getElementById('dialog');

const today = (ms) => new Date(ms).toISOString().slice(0, 10);

async function call(path, method = 'GET', body = undefined) {
  const options = { method };
  if (body instanceof Blob) {
    options.headers = { 'Content-Type': 'application/octet-stream' };
    options.body = body;
  } else if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(API + path, options);
  // Signed out or the password changed: the server answers the page with its password form.
  if (response.status === 401 || response.status === 403) {
    location.reload();
    throw new Error('Trebuie să te autentifici din nou');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  state.data = data;
  return data;
}

function badge(level, days) {
  return `<span class="badge badge--${level}">${esc(expiryText(days))}</span>`;
}

function statusNote(item) {
  return item.working || !item.status ? '' : ` <span class="status">${esc(item.status)}</span>`;
}

function button(action, label, data = {}, primary = false) {
  const attrs = Object.entries(data).map(([key, value]) => `data-${key}="${esc(value)}"`).join(' ');
  return `<button class="btn${primary ? ' btn--primary' : ''}" data-action="${action}" ${attrs}>${esc(label)}</button>`;
}

function table(headers, rows, emptyText) {
  if (!rows.length) return `<div class="table-wrap"><div class="empty">${esc(emptyText)}</div></div>`;
  const head = headers.map((header) => `<th scope="col">${esc(header)}</th>`).join('');
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function dueCell(task) {
  if (task.due === null) return '<span class="muted">—</span>';
  const late = task.dueDays < 0 ? ` <span class="status">depășit cu ${esc(count(-task.dueDays, 'zi', 'zile'))}</span>` : '';
  return `${esc(fmtShortDate(task.due))}${late}`;
}

const matches = (values) => values.join(' ').toLowerCase().includes(state.search.trim().toLowerCase());

function renderToDo() {
  const { documents, problems, docs } = state.data;
  const documentRows = documents
    .filter((item) => !state.doc || item.doc === state.doc)
    .filter((item) => !state.level || item.level === state.level)
    .filter((item) => matches([item.plate, item.label ?? '', item.location ?? '', item.docName]))
    .map((item) => {
      const data = { plate: item.plate, doc: item.doc };
      return `<tr>
        <td class="plate">${esc(item.plate)}</td>
        <td class="muted">${esc(item.label)}${statusNote(item)}</td>
        <td>${esc(item.docName)}</td>
        <td class="nowrap">${esc(fmtDate(item.date))}</td>
        <td>${badge(item.level, item.days)}</td>
        <td class="muted">${esc(item.location)}</td>
        <td class="actions">
          ${button('take-doc', 'Preia', data)}
          ${button('renew-doc', 'Rezolvat', data, true)}
          ${button('not-applicable', 'Nu se aplică', data)}
        </td>
      </tr>`;
    });

  const problemRows = problems
    .filter(() => !state.doc || state.doc === 'problema')
    .filter(() => !state.level)
    .filter((task) => matches([task.plate, task.label ?? '', task.title, task.responsible ?? '']))
    .map((task) => `<tr>
      <td class="plate">${esc(task.plate) || '—'}</td>
      <td class="muted">${esc(task.label)}</td>
      <td>${task.urgent ? '<span class="tag-urgent">Urgent</span>' : ''}${esc(task.title)}</td>
      <td class="nowrap">${dueCell(task)}</td>
      <td class="muted">de ${esc(fmtDuration(state.data.now - task.createdAt))}</td>
      <td class="muted">${esc(task.responsible)}</td>
      <td class="actions">
        ${button('take-task', 'Preia', { id: task.id })}
        ${button('finish-task', 'Rezolvat', { id: task.id }, true)}
        ${button('delete-task', 'Șterge', { id: task.id })}
      </td>
    </tr>`);

  const docOptions = Object.entries(docs)
    .map(([key, name]) => `<option value="${key}"${state.doc === key ? ' selected' : ''}>${esc(name)}</option>`)
    .join('');
  const levels = { expired: 'Expirate', urgent: 'În 7 zile', soon: 'În 8–30 de zile' };
  const levelOptions = Object.entries(levels)
    .map(([key, name]) => `<option value="${key}"${state.level === key ? ' selected' : ''}>${esc(name)}</option>`)
    .join('');

  view.innerHTML = `
    <div class="toolbar">
      <input class="grow" type="search" id="search" placeholder="Caută număr, marcă, șantier..." value="${esc(state.search)}" aria-label="Caută">
      <select id="filter-doc" aria-label="Document">
        <option value="">Toate actele</option>${docOptions}
        <option value="problema"${state.doc === 'problema' ? ' selected' : ''}>Doar probleme</option>
      </select>
      <select id="filter-level" aria-label="Urgență"><option value="">Orice termen</option>${levelOptions}</select>
      ${button('add-problem', 'Adaugă problemă', {}, true)}
      <span class="summary">${esc(count(documentRows.length, 'act', 'acte'))} · ${esc(count(problemRows.length, 'problemă', 'probleme'))}</span>
    </div>
    ${problemRows.length ? `<h3 class="section">Probleme</h3>${table(['Nr. auto', 'Mașină', 'Problemă', 'Termen', 'Deschisă', 'Responsabil', ''], problemRows, '')}<br>` : ''}
    ${table(['Nr. auto', 'Mașină', 'Act', 'Expiră', 'Stare', 'Șantier', ''], documentRows, 'Nimic de rezolvat aici.')}`;
}

function renderInProgress() {
  const rows = state.data.inProgress
    .filter((task) => matches([task.plate, task.label ?? '', task.title, task.responsible ?? '']))
    .map((task) => {
      const data = { id: task.id, plate: task.plate, doc: task.doc ?? '' };
      return `<tr>
        <td class="plate">${esc(task.plate) || '—'}</td>
        <td class="muted">${esc(task.label)}</td>
        <td>${task.urgent ? '<span class="tag-urgent">Urgent</span>' : ''}${esc(task.title)}</td>
        <td>${esc(task.responsible) || '<span class="muted">—</span>'}</td>
        <td class="muted">de ${esc(fmtDuration(state.data.now - task.startedAt))}</td>
        <td class="nowrap">${dueCell(task)}</td>
        <td class="muted">${esc(task.location)}</td>
        <td class="actions">
          ${button('finish-task', 'Rezolvat', data, true)}
          ${button('reopen-task', 'Înapoi', { id: task.id })}
        </td>
      </tr>`;
    });

  view.innerHTML = `
    <div class="toolbar">
      <input class="grow" type="search" id="search" placeholder="Caută număr, lucrare, responsabil..." value="${esc(state.search)}" aria-label="Caută">
      ${button('add-work', 'Adaugă lucrare', {}, true)}
      <span class="summary">${esc(count(rows.length, 'lucrare', 'lucrări'))}</span>
    </div>
    ${table(['Nr. auto', 'Mașină', 'Lucrare', 'Responsabil', 'În curs', 'Termen', 'Șantier', ''], rows, 'Nimic în curs. Lucrările preluate apar aici și pe monitor.')}`;
}

function documentCell(vehicle, doc) {
  const info = vehicle.docs[doc];
  const data = `data-action="edit-doc" data-plate="${esc(vehicle.plate)}" data-doc="${doc}"`;
  if (info.notApplicable) return `<button class="doc doc--na" ${data}>nu se aplică</button>`;
  if (!info.date) return `<button class="doc doc--empty" ${data} aria-label="${esc(vehicle.plate)}: fără dată">—</button>`;
  const fromMenu = info.source === 'meniu' ? '<small title="Introdusă din meniu">meniu</small>' : '';
  return `<button class="doc${info.level ? ` doc--${info.level}` : ''}" ${data}>${esc(fmtDate(info.date))}${fromMenu}</button>`;
}

function acteFilter(vehicle) {
  const docs = Object.values(vehicle.docs);
  switch (state.acteFilter) {
    case 'probleme': return docs.some((info) => info.level);
    case 'expirate': return docs.some((info) => info.level === 'expired');
    case 'fara': return !vehicle.docs.itp.date || !vehicle.docs.rca.date;
    case 'nefunctionale': return !vehicle.working;
    default: return true;
  }
}

function renderDocuments() {
  const { acte, docs } = state.data;
  const rows = acte
    .filter(acteFilter)
    .filter((vehicle) => matches([vehicle.plate, vehicle.label ?? '', vehicle.type ?? '', vehicle.location ?? '', vehicle.inventory ?? '']))
    .map((vehicle) => `<tr>
      <td class="plate">${esc(vehicle.plate)}</td>
      <td class="muted">${esc(vehicle.type)}</td>
      <td class="muted">${esc(vehicle.label)}${statusNote(vehicle)}</td>
      <td class="muted">${esc(vehicle.location)}</td>
      ${Object.keys(docs).map((doc) => `<td>${documentCell(vehicle, doc)}</td>`).join('')}
      <td>${vehicle.link ? `<a class="link" href="${esc(vehicle.link)}" target="_blank" rel="noopener noreferrer">Dosar</a>` : ''}</td>
    </tr>`);

  const filters = {
    '': 'Toate mașinile',
    probleme: 'Cu acte de rezolvat',
    expirate: 'Cu acte expirate',
    fara: 'Fără dată la ITP sau RCA',
    nefunctionale: 'Nefuncționale',
  };
  const options = Object.entries(filters)
    .map(([key, name]) => `<option value="${key}"${state.acteFilter === key ? ' selected' : ''}>${esc(name)}</option>`)
    .join('');

  view.innerHTML = `
    <div class="toolbar">
      <input class="grow" type="search" id="search" placeholder="Caută număr, marcă, tip, șantier..." value="${esc(state.search)}" aria-label="Caută">
      <select id="filter-acte" aria-label="Filtru">${options}</select>
      <span class="summary">${esc(count(rows.length, 'mașină', 'mașini'))}</span>
    </div>
    ${table(['Nr. auto', 'Tip', 'Mașină', 'Șantier', ...Object.values(docs), ''], rows, 'Nicio mașină aici. Importă fișierul Logistica Auto.')}`;
}

function renderHistory() {
  const rows = state.data.history
    .filter((task) => matches([task.plate, task.label ?? '', task.title, task.responsible ?? '', task.result ?? '']))
    .map((task) => `<tr>
      <td class="nowrap">${esc(fmtDate(task.doneAt))}</td>
      <td class="plate">${esc(task.plate) || '—'}</td>
      <td class="muted">${esc(task.label)}</td>
      <td>${esc(task.title)}</td>
      <td class="muted">${esc(task.result)}</td>
      <td class="muted">${esc(task.responsible)}</td>
    </tr>`);

  view.innerHTML = `
    <div class="toolbar">
      <input class="grow" type="search" id="search" placeholder="Caută în istoric..." value="${esc(state.search)}" aria-label="Caută">
      <span class="summary">${esc(count(rows.length, 'rezolvare', 'rezolvări'))}</span>
    </div>
    ${table(['Data', 'Nr. auto', 'Mașină', 'Ce', 'Rezultat', 'Responsabil'], rows, 'Nimic rezolvat încă.')}`;
}

function renderImport(result = state.importResult, error = state.importError) {
  const { importedAt, excluded, warnings, acte } = state.data;
  const list = (items) => (items.length ? `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : '');
  const last = importedAt
    ? `<div class="card">
        <strong>Ultimul import: ${esc(fmtDate(importedAt))}</strong>
        ${esc(count(acte.length, 'mașină', 'mașini'))} pe panou, ${esc(count(excluded, 'exclusă', 'excluse'))} (radiate sau vândute).
        ${list(warnings)}
      </div>`
    : '';

  view.innerHTML = `
    <section class="import">
      <h2>Importă Logistica Auto</h2>
      <p>Citesc doar foile VALABILITATE ACTE și EVIDENTA AUTO: numărul, tipul, marca, statusul, șantierul, valabilitățile și linkul de dosar. Datele șoferilor nu se citesc, iar fișierul în sine nu se păstrează pe server.</p>
      <p>Dacă în Excel e o dată mai veche decât cea trecută aici din meniu, rămâne cea din meniu.</p>
      <form id="import-form">
        <input type="file" id="import-file" accept=".xlsx" required aria-label="Fișier Excel">
        <button class="btn btn--primary" id="import-send">Importă</button>
      </form>
      ${error ? `<div class="notice notice--bad" style="margin:0">${esc(error)}</div>` : ''}
      ${result ? `<div class="notice notice--good" style="margin:0">Import reușit: ${esc(count(result.vehicles, 'mașină', 'mașini'))}, ${esc(count(result.excluded, 'exclusă', 'excluse'))} (radiate sau vândute).</div>` : ''}
      ${last}
    </section>`;
}

const RENDERERS = {
  rezolvat: renderToDo,
  curs: renderInProgress,
  acte: renderDocuments,
  istoric: renderHistory,
  import: renderImport,
};

function renderTabs() {
  const { documents, problems, inProgress } = state.data;
  const badges = { rezolvat: documents.length + problems.length, curs: inProgress.length };
  document.getElementById('tabs').innerHTML = Object.entries(TABS).map(([key, name]) => {
    const number = badges[key] === undefined ? '' : `<b>${badges[key]}</b>`;
    return `<button class="tab" role="tab" aria-selected="${state.tab === key}" data-tab="${key}">${esc(name)}${number}</button>`;
  }).join('');
}

function renderNotice() {
  const { persistent, importedAt } = state.data;
  let text = '';
  if (!persistent) text = 'Serverul nu are volum: tot ce salvezi aici se pierde la următorul deploy. Adaugă un Volume în Railway.';
  else if (!importedAt) text = 'Nu sunt încă date. Importă fișierul Logistica Auto din fila Import Excel.';
  notice.hidden = !text;
  notice.textContent = text;
}

function render() {
  renderTabs();
  renderNotice();
  RENDERERS[state.tab]();
}

// Rebuilding the list must not throw the cursor out of the search box.
function renderKeepingFocus() {
  const search = document.getElementById('search');
  const position = search && document.activeElement === search ? search.selectionStart : null;
  render();
  if (position !== null) {
    const next = document.getElementById('search');
    next.focus();
    next.setSelectionRange(position, position);
  }
}

let dialogSubmit = null;

function openDialog({ title, note = '', fields, ok = 'Salvează', onSubmit }) {
  document.getElementById('dialog-title').textContent = title;
  document.getElementById('dialog-note').textContent = note;
  document.getElementById('dialog-ok').textContent = ok;
  document.getElementById('dialog-error').hidden = true;
  document.getElementById('dialog-fields').innerHTML = fields.map((field) => {
    const common = `name="${field.name}"${field.required ? ' required' : ''}`;
    if (field.type === 'checkbox') {
      return `<label class="field field--check"><input type="checkbox" ${common}${field.value ? ' checked' : ''}><span>${esc(field.label)}</span></label>`;
    }
    const extra = [field.list ? `list="${field.list}"` : '', field.min ? `min="${field.min}"` : '', field.maxlength ? `maxlength="${field.maxlength}"` : ''].join(' ');
    return `<label class="field"><span>${esc(field.label)}</span><input type="${field.type || 'text'}" ${common} ${extra} value="${esc(field.value)}"></label>`;
  }).join('');
  dialogSubmit = onSubmit;
  dialog.showModal();
}

document.getElementById('dialog-cancel').addEventListener('click', () => dialog.close());

document.getElementById('dialog-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const ok = document.getElementById('dialog-ok');
  const errorEl = document.getElementById('dialog-error');
  const form = event.target;
  const values = Object.fromEntries(new FormData(form).entries());
  for (const box of form.querySelectorAll('input[type="checkbox"]')) values[box.name] = box.checked;
  ok.disabled = true;
  try {
    await dialogSubmit(values);
    dialog.close();
    render();
  } catch (err) {
    errorEl.hidden = false;
    errorEl.textContent = err.message;
  }
  ok.disabled = false;
});

function plateList() {
  const options = state.data.acte.map((vehicle) => `<option value="${esc(vehicle.plate)}">`).join('');
  document.getElementById('plates')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<datalist id="plates">${options}</datalist>`);
}

const docName = (doc) => state.data.docs[doc];
const responsibleFields = () => [
  { name: 'responsible', label: 'Responsabil (opțional)', maxlength: 200 },
  { name: 'due', label: 'Termen (opțional)', type: 'date' },
];

function renewDialog({ plate, doc }) {
  openDialog({
    title: `${plate}: ${docName(doc)}`,
    note: 'Până când este valabil după reînnoire?',
    fields: [{ name: 'date', label: 'Valabil până la', type: 'date', required: true, min: today(state.data.now) }],
    onSubmit: (values) => call('/acte/rezolvat', 'POST', { plate, doc, date: values.date }),
  });
}

function problemDialog(stage, title) {
  plateList();
  openDialog({
    title,
    fields: [
      { name: 'plate', label: 'Nr. auto (opțional)', list: 'plates', maxlength: 200 },
      { name: 'title', label: 'Ce e de făcut', required: true, maxlength: 200 },
      ...responsibleFields(),
      { name: 'urgent', label: 'Urgent', type: 'checkbox' },
    ],
    onSubmit: (values) => call('/probleme', 'POST', { ...values, stage }),
  });
}

async function act(run) {
  try {
    await run();
    render();
  } catch (err) {
    notice.hidden = false;
    notice.textContent = err.message;
  }
}

const ACTIONS = {
  'add-problem': () => problemDialog('de-rezolvat', 'Problemă nouă'),
  'add-work': () => problemDialog('in-curs', 'Lucrare nouă'),

  'take-doc': ({ plate, doc }) => openDialog({
    title: `Preia ${plate}: ${docName(doc)}`,
    note: 'Trece la În curs și apare pe monitor.',
    fields: responsibleFields(),
    ok: 'Preia',
    onSubmit: (values) => call('/acte/preia', 'POST', { plate, doc, ...values }),
  }),

  'renew-doc': renewDialog,

  'not-applicable': ({ plate, doc }) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`${docName(doc)} nu se aplică pentru ${plate}? Dispare de pe monitor. Poți reveni din fila Acte.`)) return;
    act(() => call('/acte/nu-se-aplica', 'POST', { plate, doc, value: true }));
  },

  'take-task': ({ id }) => openDialog({
    title: 'Preia problema',
    note: 'Trece la În curs și apare pe monitor.',
    fields: responsibleFields(),
    ok: 'Preia',
    onSubmit: (values) => call(`/lucrari/${encodeURIComponent(id)}/preia`, 'POST', values),
  }),

  'finish-task': ({ id, plate, doc }) => {
    if (doc) {
      openDialog({
        title: `${plate}: ${docName(doc)}`,
        note: 'Până când este valabil după reînnoire?',
        fields: [{ name: 'date', label: 'Valabil până la', type: 'date', required: true, min: today(state.data.now) }],
        onSubmit: (values) => call(`/lucrari/${encodeURIComponent(id)}/rezolvat`, 'POST', values),
      });
      return;
    }
    openDialog({
      title: 'Marchează rezolvat',
      fields: [{ name: 'note', label: 'Notă (opțional)', maxlength: 200 }],
      ok: 'Rezolvat',
      onSubmit: (values) => call(`/lucrari/${encodeURIComponent(id)}/rezolvat`, 'POST', values),
    });
  },

  'reopen-task': ({ id }) => act(() => call(`/lucrari/${encodeURIComponent(id)}/inapoi`, 'POST', {})),

  'delete-task': ({ id }) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Ștergi problema? Nu rămâne în istoric.')) return;
    act(() => call(`/lucrari/${encodeURIComponent(id)}`, 'DELETE'));
  },

  'edit-doc': ({ plate, doc }) => {
    const vehicle = state.data.acte.find((candidate) => candidate.plate === plate);
    const info = vehicle.docs[doc];
    openDialog({
      title: `${plate}: ${docName(doc)}`,
      note: info.date ? `Acum: ${fmtDate(info.date)}${info.source === 'meniu' ? ' (din meniu)' : ' (din Excel)'}` : 'Nu are dată.',
      fields: [
        { name: 'date', label: 'Valabil până la', type: 'date' },
        { name: 'notApplicable', label: 'Nu se aplică acestei mașini', type: 'checkbox', value: info.notApplicable },
      ],
      onSubmit: async (values) => {
        if (values.date) await call('/acte/rezolvat', 'POST', { plate, doc, date: values.date });
        if (values.notApplicable !== info.notApplicable) {
          await call('/acte/nu-se-aplica', 'POST', { plate, doc, value: values.notApplicable });
        }
      },
    });
  },
};

document.body.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-tab]');
  if (tab) {
    state.tab = tab.dataset.tab;
    state.search = '';
    state.importResult = null;
    state.importError = null;
    render();
    return;
  }
  const target = event.target.closest('[data-action]');
  if (target) ACTIONS[target.dataset.action]({ ...target.dataset });
});

view.addEventListener('input', (event) => {
  if (event.target.id === 'search') {
    state.search = event.target.value;
    renderKeepingFocus();
  }
});

view.addEventListener('change', (event) => {
  if (event.target.id === 'filter-doc') state.doc = event.target.value;
  else if (event.target.id === 'filter-level') state.level = event.target.value;
  else if (event.target.id === 'filter-acte') state.acteFilter = event.target.value;
  else return;
  render();
});

view.addEventListener('submit', async (event) => {
  if (event.target.id !== 'import-form') return;
  event.preventDefault();
  const send = document.getElementById('import-send');
  send.disabled = true;
  state.importResult = null;
  state.importError = null;
  try {
    const data = await call('/import', 'POST', document.getElementById('import-file').files[0]);
    state.importResult = data.importResult;
  } catch (err) {
    state.importError = err.message;
  }
  render();
});

async function refresh() {
  // Never rebuild the page under someone who is typing in a dialog or choosing a file.
  if (dialog.open || state.tab === 'import') return;
  await call('/');
  renderKeepingFocus();
}

async function main() {
  await call('/');
  render();
  setInterval(() => refresh().catch(console.error), REFRESH_MS);
}

main().catch((err) => {
  notice.hidden = false;
  notice.textContent = err.message;
});
