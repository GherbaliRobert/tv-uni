import { esc, icon, plate, fmtDuration, fmtDayTime, fmtShortDate, now, remPx } from './util.js';

const STATES = {
  moving: { label: 'Pornite', hint: 'în mers', icon: 'move', priority: 0 },
  idle: { label: 'Staționate', hint: 'motor pornit', icon: 'pause', priority: 1 },
  off: { label: 'Oprite', hint: 'contact luat', icon: 'stop', priority: 3 },
  nosignal: { label: 'Fără semnal', hint: 'nu raportează', icon: 'nosignal', priority: 2 },
};

const REFIT_MS = 10 * 60000;
const FAN_RADII_REM = [3.2, 5, 7];
const FAN_DIRECTIONS = [[1, 0], [-1, 0], [0, -1], [0, 1], [0.7, -0.7], [-0.7, -0.7], [0.7, 0.7], [-0.7, 0.7]];

let map;
let cfg;
let lastFit = 0;
const markers = new Map();

export function initGps(appConfig) {
  cfg = appConfig;
  const { harta } = cfg;
  map = L.map('map', {
    zoomControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    touchZoom: false,
    fadeAnimation: false,
    zoomAnimation: false,
    markerZoomAnimation: false,
    zoomSnap: 0.5,
  }).setView(harta.centru, harta.zoom);
  map.attributionControl.setPrefix(false);

  // On a 4K screen the rem doubles; double the tiles too so map text stays readable.
  const large = remPx() >= 24;
  L.tileLayer(harta.tile, {
    attribution: harta.atribuire,
    maxZoom: 19,
    tileSize: large ? 512 : 256,
    zoomOffset: large ? -1 : 0,
  }).addTo(map);

  map.on('zoomend moveend', placeLabels);
  document.getElementById('speeds-legend').innerHTML = `
    <span><i style="background:var(--accent)"></i>până în ${cfg.pragVitezaAtentie} km/h</span>
    <span><i style="background:var(--warn)"></i>peste ${cfg.pragVitezaAtentie}</span>
    <span><i style="background:var(--crit)"></i>peste ${cfg.pragVitezaCritic}</span>`;
}

function labelExtra(vehicle) {
  if (vehicle.state === 'moving') return `${vehicle.speed} km/h`;
  if (vehicle.state === 'idle') return fmtDuration(now() - vehicle.since);
  return '';
}

function renderMarker(vehicle) {
  let entry = markers.get(vehicle.id);
  if (!entry) {
    const marker = L.marker([vehicle.lat, vehicle.lng], {
      icon: L.divIcon({ className: 'vm-host', html: '', iconSize: [0, 0] }),
      interactive: false,
      keyboard: false,
    }).addTo(map);
    const el = marker.getElement();
    el.innerHTML = '<div class="vm"><span class="vm-leader"></span><span class="vm-dot"></span><span class="vm-label"></span></div>';
    entry = {
      marker,
      root: el.firstChild,
      dot: el.querySelector('.vm-dot'),
      label: el.querySelector('.vm-label'),
      leader: el.querySelector('.vm-leader'),
      state: null,
    };
    markers.set(vehicle.id, entry);
  }

  entry.marker.setLatLng([vehicle.lat, vehicle.lng]);
  if (entry.state !== vehicle.state) {
    entry.state = vehicle.state;
    entry.root.classList.remove('vm--moving', 'vm--idle', 'vm--off', 'vm--nosignal');
    entry.root.classList.add(`vm--${vehicle.state}`, `tone-${vehicle.state}`);
    entry.root.classList.remove(...['moving', 'idle', 'off', 'nosignal']
      .filter((s) => s !== vehicle.state)
      .map((s) => `tone-${s}`));
    entry.dot.innerHTML = icon(STATES[vehicle.state].icon);
    // Moving vehicles sit on top of parked ones.
    entry.marker.setZIndexOffset((3 - STATES[vehicle.state].priority) * 1000);
  }
  entry.root.style.setProperty('--heading', `${vehicle.heading || 0}deg`);
  const extra = labelExtra(vehicle);
  entry.label.innerHTML = `${esc(vehicle.plate)}${extra ? `<em>${esc(extra)}</em>` : ''}`;
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// Next to the dot first; in a crowded area, further out with a leader line.
// Parked vehicles only get a label if there is room right next to them.
function labelOptions(state, w, h, rem) {
  const reach = (state === 'moving' || state === 'idle' ? 1.2 : 0.85) * rem;
  const options = [
    { x: reach, y: -h / 2 },
    { x: -reach - w, y: -h / 2 },
    { x: -w / 2, y: -reach - h },
    { x: -w / 2, y: reach },
  ];
  if (state === 'off') return options;
  for (const radius of FAN_RADII_REM) {
    for (const [dx, dy] of FAN_DIRECTIONS) {
      options.push({
        x: dx * (radius * rem + w / 2) - w / 2,
        y: dy * (radius * rem + h / 2) - h / 2,
        leader: true,
      });
    }
  }
  return options;
}

function setLeader(entry, option, w, h) {
  entry.root.classList.toggle('vm--leader', Boolean(option && option.leader));
  if (!option || !option.leader) return;
  const cx = option.x + w / 2;
  const cy = option.y + h / 2;
  entry.leader.style.width = `${Math.hypot(cx, cy)}px`;
  entry.leader.style.transform = `rotate(${Math.atan2(cy, cx)}rad)`;
}

// Places plate labels in free space, most important vehicles first. A label that
// can't fit is hidden; the colored dot still shows the vehicle and its state.
function placeLabels() {
  const rem = remPx();
  const size = map.getSize();
  const items = [...markers.values()]
    .map((entry) => ({ entry, pt: map.latLngToContainerPoint(entry.marker.getLatLng()) }))
    .sort((a, b) => STATES[a.entry.state].priority - STATES[b.entry.state].priority);

  const dotRadius = 1.05 * rem;
  const dots = items
    .filter((i) => i.entry.state === 'moving' || i.entry.state === 'idle')
    .map((i) => ({ owner: i.entry, x: i.pt.x - dotRadius, y: i.pt.y - dotRadius, w: dotRadius * 2, h: dotRadius * 2 }));
  const placed = [];
  const gap = 0.2 * rem;

  for (const { entry, pt } of items) {
    const w = entry.label.offsetWidth;
    const h = entry.label.offsetHeight;
    const fit = labelOptions(entry.state, w, h, rem).find((o) => {
      const box = { x: pt.x + o.x - gap, y: pt.y + o.y - gap, w: w + gap * 2, h: h + gap * 2 };
      const inside = box.x >= 0 && box.y >= 0 && box.x + box.w <= size.x && box.y + box.h <= size.y;
      return inside
        && !placed.some((p) => overlaps(box, p))
        && !dots.some((d) => d.owner !== entry && overlaps(box, d));
    });
    entry.root.classList.toggle('vm--nolabel', !fit);
    setLeader(entry, fit, w, h);
    if (fit) {
      entry.label.style.left = `${fit.x}px`;
      entry.label.style.top = `${fit.y}px`;
      placed.push({ x: pt.x + fit.x - gap, y: pt.y + fit.y - gap, w: w + gap * 2, h: h + gap * 2 });
    }
  }
}

function fitFleet(vehicles) {
  if (!vehicles.length) return;
  const rem = remPx();
  const bounds = L.latLngBounds(vehicles.map((v) => [v.lat, v.lng]));
  const due = Date.now() - lastFit > REFIT_MS;
  const outside = !map.getBounds().pad(-0.04).contains(bounds);
  if (!due && !outside) return;
  lastFit = Date.now();
  map.fitBounds(bounds, {
    paddingTopLeft: [5 * rem, 3 * rem],
    paddingBottomRight: [11 * rem, 3 * rem],
    maxZoom: cfg.harta.zoomMaxim,
    animate: false,
  });
}

function renderTiles(counts) {
  document.getElementById('state-tiles').innerHTML = Object.entries(STATES).map(([key, s]) => `
    <div class="state-tile tone-${key}">
      <span class="state-ic">${icon(s.icon)}</span>
      <b>${counts[key]}</b>
      <span class="lbl">${s.label}</span>
      <small>${s.hint}</small>
    </div>`).join('');
}

function renderSpeeds(top) {
  document.getElementById('speeds-week').textContent = `Săptămâna ${top.week} · ${fmtShortDate(top.from)} – ${fmtShortDate(top.to)}`;
  const list = document.getElementById('speeds');
  if (!top.items.length) {
    list.innerHTML = '<li class="empty-line" style="display:flex;border:0">Nicio deplasare înregistrată încă în această săptămână</li>';
    return;
  }
  const scale = Math.max(130, top.items[0].speed);
  list.innerHTML = top.items.map((item, i) => {
    const crit = item.speed > cfg.pragVitezaCritic;
    const warn = item.speed > cfg.pragVitezaAtentie;
    const tone = crit ? 'spd--crit' : warn ? 'spd--warn' : '';
    return `<li class="${tone}">
      <span class="spd-rank">${i + 1}</span>
      ${plate(item.plate)}
      <span class="spd-when">${esc(fmtDayTime(item.at))}</span>
      <span class="spd-bar"><i style="width:${(item.speed / scale) * 100}%"></i></span>
      <span class="spd-val">${crit ? icon('alert') : ''}${item.speed}<small>km/h</small></span>
    </li>`;
  }).join('');
}

function renderIdle(vehicles) {
  const list = document.getElementById('idle');
  if (!vehicles.length) {
    list.innerHTML = '<li class="empty-line" style="flex:1;display:flex;border:0">Nicio mașină staționată cu motorul pornit</li>';
    return;
  }
  list.innerHTML = vehicles.slice(0, 5).map((v) => `<li>
    ${plate(v.plate)}
    <span class="type">${esc(v.type)}</span>
    <span class="dur">${esc(fmtDuration(now() - v.since))}</span>
  </li>`).join('');
}

export function renderGps(data) {
  const seen = new Set();
  for (const vehicle of data.vehicles) {
    seen.add(vehicle.id);
    renderMarker(vehicle);
  }
  for (const [id, entry] of markers) {
    if (!seen.has(id)) {
      entry.marker.remove();
      markers.delete(id);
    }
  }
  fitFleet(data.vehicles);
  placeLabels();
  renderTiles(data.counts);
  renderSpeeds(data.topSpeeds);
  renderIdle(data.idleLongest);
}
