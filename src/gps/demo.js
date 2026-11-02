// Simulated fleet, used until a real GPS provider is connected.
// Everything here is invented: plates, positions, speeds.

const ROUTES = {
  a1: [[44.44, 25.95], [44.50, 25.62], [44.62, 25.33], [44.77, 25.05], [44.86, 24.87]],
  a3: [[44.52, 26.07], [44.70, 26.04], [44.88, 26.03]],
  dn1: [[44.94, 26.02], [45.10, 25.75], [45.35, 25.55], [45.52, 25.57], [45.65, 25.60]],
  a2: [[44.41, 26.25], [44.35, 26.70], [44.38, 27.35], [44.35, 27.85], [44.30, 28.30], [44.19, 28.60]],
  dn2: [[44.50, 26.15], [44.70, 26.50], [45.00, 26.72], [45.15, 26.82]],
  dn7: [[44.86, 24.87], [45.00, 24.60], [45.10, 24.37]],
  dn65: [[44.86, 24.87], [44.55, 24.45], [44.43, 24.36], [44.32, 23.80]],
};

const SITES = {
  baza: [44.482, 26.05],
  fetesti: [44.37, 27.82],
  sinaia: [45.35, 25.55],
  slatina: [44.43, 24.36],
};

// [plate, type, road route | site]
const FLEET = [
  ['B-101-UTP', 'Autobasculantă', 'a1'],
  ['B-102-UTP', 'Autobasculantă', 'a1'],
  ['B-103-UTP', 'Autobasculantă', 'a2'],
  ['B-104-UTP', 'Autobasculantă', 'a2'],
  ['B-105-UTP', 'Autobasculantă', 'a3'],
  ['B-106-UTP', 'Autobasculantă', 'dn1'],
  ['B-107-UTP', 'Autobasculantă', 'dn2'],
  ['B-108-UTP', 'Autobasculantă', 'dn65'],
  ['IF-11-UTP', 'Autobasculantă', 'dn7'],
  ['IF-12-UTP', 'Autobasculantă', 'dn65'],
  ['B-201-UTP', 'Autoutilitară', 'a3'],
  ['B-202-UTP', 'Autoutilitară', 'a1'],
  ['B-203-UTP', 'Autoutilitară', 'dn2'],
  ['B-204-UTP', 'Autoutilitară', 'dn1'],
  ['IF-21-UTP', 'Autoutilitară', 'a2'],
  ['IF-22-UTP', 'Autoutilitară', 'dn7'],
  ['B-301-UTP', 'Autoturism', 'a1'],
  ['B-302-UTP', 'Autoturism', 'a2'],
  ['B-303-UTP', 'Autoturism', 'a3'],
  ['B-304-UTP', 'Autoturism', 'dn1'],
  ['B-401-UTP', 'Betonieră', 'dn2'],
  ['B-402-UTP', 'Betonieră', 'a3'],
  ['B-403-UTP', 'Betonieră', 'dn65'],
  ['B-501-UTP', 'Cap tractor', 'a2'],
  ['B-502-UTP', 'Cap tractor', 'a1'],
  ['B-503-UTP', 'Cap tractor', 'dn2'],
  ['EXC-01', 'Excavator', 'fetesti'],
  ['EXC-02', 'Excavator', 'sinaia'],
  ['EXC-03', 'Excavator', 'slatina'],
  ['BLD-01', 'Buldoexcavator', 'baza'],
  ['BLD-02', 'Buldoexcavator', 'fetesti'],
  ['CIL-01', 'Cilindru compactor', 'slatina'],
];

const CRUISE = {
  Autobasculantă: 72,
  Autoutilitară: 88,
  Autoturism: 92,
  Betonieră: 62,
  'Cap tractor': 80,
};

// Stopped reporting: visible as "fără semnal".
const SILENT = { 'B-204-UTP': 3 * 3600000, 'IF-22-UTP': 50 * 3600000 };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function distanceKm([lat1, lng1], [lat2, lng2]) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function bearing([lat1, lng1], [lat2, lng2]) {
  const rad = Math.PI / 180;
  const y = Math.sin((lng2 - lng1) * rad) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad)
    - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lng2 - lng1) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

function routeLength(route) {
  let total = 0;
  for (let i = 1; i < route.length; i += 1) total += distanceKm(route[i - 1], route[i]);
  return total;
}

function pointOnRoute(route, dist, direction) {
  let left = dist;
  for (let i = 1; i < route.length; i += 1) {
    const seg = distanceKm(route[i - 1], route[i]);
    if (left <= seg || i === route.length - 1) {
      const f = Math.min(left / seg, 1);
      const from = route[i - 1];
      const to = route[i];
      const heading = direction > 0 ? bearing(from, to) : bearing(to, from);
      return { lat: from[0] + (to[0] - from[0]) * f, lng: from[1] + (to[1] - from[1]) * f, heading };
    }
    left -= seg;
  }
  return { lat: route[0][0], lng: route[0][1], heading: 0 };
}

const random = rng(45);
const startedAt = Date.now();
let lastTick = startedAt;

const pick = (min, max) => min + random() * (max - min);
const minutes = (min, max) => pick(min, max) * 60000;

function nextPhase(vehicle, now) {
  const r = random();
  let phase;
  if (vehicle.fixed) phase = vehicle.phase === 'idle' ? 'off' : 'idle';
  else if (vehicle.phase === 'moving') phase = r < 0.6 ? 'idle' : 'off';
  else phase = r < 0.75 ? 'moving' : vehicle.phase === 'idle' ? 'off' : 'idle';

  vehicle.phase = phase;
  vehicle.since = now;
  vehicle.phaseEnd = now + (phase === 'moving' ? minutes(6, 35) : phase === 'idle' ? minutes(3, 25) : minutes(20, 90));
}

const vehicles = FLEET.map(([plate, type, place], index) => {
  const fixed = Boolean(SITES[place]);
  const route = fixed ? null : ROUTES[place];
  const r = random();
  const phase = fixed ? (r < 0.5 ? 'idle' : 'off') : r < 0.5 ? 'moving' : r < 0.7 ? 'idle' : 'off';
  const site = fixed ? SITES[place] : null;
  return {
    id: `demo-${index}`,
    plate,
    type,
    fixed,
    route,
    site: site && [site[0] + pick(-0.01, 0.01), site[1] + pick(-0.014, 0.014)],
    length: route ? routeLength(route) : 0,
    dist: route ? pick(0, routeLength(route)) : 0,
    direction: random() < 0.5 ? 1 : -1,
    cruise: CRUISE[type] ?? 70,
    speed: CRUISE[type] ?? 70,
    phase,
    since: startedAt - minutes(1, 45),
    phaseEnd: startedAt + minutes(2, 30),
  };
});

function tick(now) {
  const elapsedHours = (now - lastTick) / 3600000;
  lastTick = now;
  for (const v of vehicles) {
    if (now >= v.phaseEnd) nextPhase(v, now);
    if (v.phase !== 'moving') continue;
    v.speed = Math.min(Math.max(v.speed + pick(-9, 9), v.cruise * 0.55), v.cruise * 1.25);
    v.dist += v.direction * v.speed * elapsedHours;
    if (v.dist <= 0 || v.dist >= v.length) {
      v.direction = -v.direction;
      v.dist = Math.min(Math.max(v.dist, 0), v.length);
    }
  }
}

async function fetchPositions() {
  const now = Date.now();
  tick(now);
  return vehicles.map((v) => {
    const silentFor = SILENT[v.plate];
    const position = v.fixed
      ? { lat: v.site[0], lng: v.site[1], heading: null }
      : pointOnRoute(v.route, v.dist, v.direction);
    return {
      id: v.id,
      plate: v.plate,
      type: v.type,
      ...position,
      speed: v.phase === 'moving' ? v.speed : 0,
      ignition: v.phase !== 'off',
      timestamp: silentFor ? now - silentFor : now,
      stateSince: silentFor ? now - silentFor : v.since,
    };
  });
}

// Stands in for a provider's trip report, so the weekly ranking isn't empty on start.
async function fetchWeeklyMaxSpeeds(from, to) {
  const seeded = rng(Math.floor(from / 86400000));
  return vehicles
    .filter((v) => !v.fixed)
    .map((v) => ({
      plate: v.plate,
      speed: Math.round(v.cruise * (1 + seeded() * 0.32)),
      at: Math.round(from + seeded() * (to - from)),
    }));
}

module.exports = {
  isDemo: true,
  fetchPositions,
  fetchWeeklyMaxSpeeds,
  DEMO_FLEET: FLEET.map(([plate, type]) => ({ plate, type })),
};
