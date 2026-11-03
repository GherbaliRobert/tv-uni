import { initGps, renderGps } from './gps.js';
import { initMecanizare, renderMecanizare, startPaging, stopPaging } from './mecanizare.js';
import { TZ, esc, icon, now, syncClock, fmtDuration, fmtShortDate, fmtTime } from './util.js';

const MECANIZARE_REFRESH_MS = 30000;
const STALE_GPS_INTERVALS = 4;

window.panouPornit = true;

const params = new URLSearchParams(location.search);
let tabs = [...document.querySelectorAll('.tab')];
let buttons = [...document.querySelectorAll('.tab-btn')];

const state = {
  active: 0,
  paused: false,
  rotationMs: 120000,
  gps: null,
  mecanizare: null,
  lastOk: 0,
  connectionLost: false,
  gpsIntervalMs: 15000,
};

let rotationTimer;

function scheduleRotation() {
  clearTimeout(rotationTimer);
  if (!state.paused && state.rotationMs > 0 && tabs.length > 1) {
    rotationTimer = setTimeout(() => showTab(state.active + 1), state.rotationMs);
  }
}

function showTab(index) {
  state.active = (index + tabs.length) % tabs.length;
  tabs.forEach((tab, i) => tab.classList.toggle('active', i === state.active));
  buttons.forEach((button, i) => button.classList.toggle('active', i === state.active));
  if (tabs[state.active].id === 'tab-mec') startPaging(state.rotationMs);
  else stopPaging();
  scheduleRotation();
}

// A TV remote has no F key, but its OK button arrives as Enter or as a click.
function enterFullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (request) request.call(root);
}

function togglePause() {
  state.paused = !state.paused;
  document.body.classList.toggle('paused', state.paused);
  scheduleRotation();
  renderStatus();
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight') showTab(state.active + 1);
  else if (event.key === 'ArrowLeft') showTab(state.active - 1);
  else if (event.key === ' ') togglePause();
  else if (event.key === 'Enter') enterFullscreen();
  else if (String(event.key).toLowerCase() === 'f') {
    if (document.fullscreenElement) document.exitFullscreen();
    else enterFullscreen();
  }
});
document.addEventListener('click', enterFullscreen);

async function getJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

// A failed request keeps the previous data on screen; the top bar says it is old.
async function refresh(url, apply) {
  try {
    const data = await getJson(url);
    syncClock(data.now);
    state.connectionLost = false;
    state.lastOk = Date.now();
    apply(data);
  } catch (err) {
    state.connectionLost = true;
    console.error(err);
  }
  renderStatus();
}

const refreshGps = () => refresh('/api/gps', (data) => {
  state.gps = data;
  renderGps(data);
});

const refreshMecanizare = () => refresh('/api/mecanizare', (data) => {
  state.mecanizare = data;
  renderMecanizare(data);
});

function renderStatus() {
  const chips = [];
  const { gps, mecanizare } = state;

  if (state.connectionLost) {
    const since = state.lastOk ? ` — date din ${fmtTime(state.lastOk)}` : '';
    chips.push(`<span class="chip chip--bad">${icon('alert')}Fără legătură cu serverul${esc(since)}</span>`);
  }

  if (gps) {
    const age = gps.updatedAt ? now() - gps.updatedAt : null;
    if (age === null || age > state.gpsIntervalMs * STALE_GPS_INTERVALS) {
      const when = age === null ? 'fără date' : `ultimele date acum ${fmtDuration(age)}`;
      chips.push(`<span class="chip chip--bad">${icon('alert')}GPS: ${esc(when)}</span>`);
    } else {
      chips.push(`<span class="chip">GPS actualizat ${esc(fmtTime(gps.updatedAt))}</span>`);
    }
  }
  if (mecanizare && mecanizare.updatedAt) {
    chips.push(`<span class="chip">Date din ${esc(fmtShortDate(mecanizare.updatedAt))}</span>`);
  }

  if (gps && gps.demo) chips.push('<span class="chip chip--demo">DATE DEMO (GPS)</span>');
  if (state.paused) chips.push(`<span class="chip chip--pause">${icon('pause')}Rotire oprită</span>`);

  document.getElementById('status').innerHTML = chips.join('');
}

const clockTime = new Intl.DateTimeFormat('ro-RO', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const clockDate = new Intl.DateTimeFormat('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });

function renderClock() {
  const date = clockDate.format(now());
  document.getElementById('clock-time').textContent = clockTime.format(now());
  document.getElementById('clock-date').textContent = date[0].toUpperCase() + date.slice(1);
}

// A browser left open for weeks: reload once a night, only if the server is answering.
function nightlyReload() {
  const hour = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: TZ }).format(now());
  const recentlyOk = Date.now() - state.lastOk < 120000;
  const runningLong = performance.now() > 3600000;
  if (Number(hour) === 4 && recentlyOk && runningLong) location.reload();
}

async function main() {
  const config = await getJson('/api/config');
  const rotationParam = params.get('rotatie');
  const rotationSeconds = rotationParam === null ? config.rotatieSecunde : Number(rotationParam);
  state.rotationMs = rotationSeconds * 1000;
  state.gpsIntervalMs = config.actualizareGpsSecunde * 1000;
  document.documentElement.style.setProperty('--rotation', `${rotationSeconds}s`);

  initMecanizare(config);
  if (config.gps) {
    initGps(config);
  } else {
    // Off for now: a single tab, so there is nothing to rotate or to choose from.
    document.getElementById('tab-gps').remove();
    document.querySelector('.tabs').remove();
    tabs = [...document.querySelectorAll('.tab')];
    buttons = [];
  }

  renderClock();
  setInterval(renderClock, 1000);
  setInterval(renderStatus, 5000);
  setInterval(nightlyReload, 60000);

  showTab(params.get('fila') === 'mecanizare' ? tabs.length - 1 : 0);

  await refreshMecanizare();
  setInterval(refreshMecanizare, MECANIZARE_REFRESH_MS);
  if (config.gps) {
    await refreshGps();
    setInterval(refreshGps, state.gpsIntervalMs);
  }
}

main().catch((err) => {
  console.error(err);
  // Server not up yet (TV powered on first): try again.
  setTimeout(() => location.reload(), 10000);
});
