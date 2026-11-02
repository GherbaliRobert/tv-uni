const fs = require('fs');
const path = require('path');
const { isoWeek, weekBounds } = require('../dates');

// To connect a real GPS provider: add a module here exposing fetchPositions()
// (see README) and set "furnizor" in config.json.
const PROVIDERS = {
  demo: () => require('./demo'),
};

const REPORT_REFRESH_MS = 10 * 60000;

function classify(position, now, cfg) {
  const age = now - position.timestamp;
  const limit = position.ignition
    ? cfg.faraSemnalMinutePornit * 60000
    : cfg.faraSemnalOreOprit * 3600000;
  if (age > limit) return 'nosignal';
  if (!position.ignition) return 'off';
  return position.speed >= cfg.vitezaMinimaMiscare ? 'moving' : 'idle';
}

function weekKey(now) {
  const { year, week } = isoWeek(new Date(now));
  return `${year}-W${week}`;
}

// Keeps the highest plausible speed per vehicle for the current week. Returns true if it changed.
function recordSpeed(week, entry, cfg) {
  if (!(entry.speed > 0)) return false;
  if (entry.speed > cfg.vitezaMaximaPlauzibila) {
    console.warn(`Viteză ignorată (eroare GPS probabilă): ${entry.plate} ${entry.speed} km/h`);
    return false;
  }
  const { start, end } = weekBounds(new Date());
  if (entry.at < start.getTime() || entry.at >= end.getTime()) return false;
  const current = week.maxes[entry.plate];
  if (current && current.speed >= entry.speed) return false;
  week.maxes[entry.plate] = { speed: entry.speed, at: entry.at };
  return true;
}

function readWeek(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { key: null, maxes: {} };
  }
}

function writeWeek(file, week) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(week, null, 1));
  fs.renameSync(tmp, file);
}

function createGpsTracker(cfg, dataDir) {
  const loadProvider = PROVIDERS[cfg.furnizor];
  if (!loadProvider) throw new Error(`Furnizor GPS necunoscut în config.json: "${cfg.furnizor}"`);
  const provider = loadProvider();
  const weekFile = path.join(dataDir, `viteze-saptamana-${cfg.furnizor}.json`);

  let week = readWeek(weekFile);
  let positions = [];
  let updatedAt = null;
  let error = null;
  let lastReport = 0;
  const tracks = new Map();

  function currentWeek(now) {
    const key = weekKey(now);
    if (week.key !== key) {
      week = { key, maxes: {} };
      lastReport = 0;
    }
    return week;
  }

  async function mergeReport(now) {
    if (!provider.fetchWeeklyMaxSpeeds || now - lastReport < REPORT_REFRESH_MS) return false;
    lastReport = now;
    const { start } = weekBounds(new Date(now));
    const report = await provider.fetchWeeklyMaxSpeeds(start.getTime(), now);
    return report.map((entry) => recordSpeed(week, entry, cfg)).some(Boolean);
  }

  async function poll() {
    try {
      const now = Date.now();
      currentWeek(now);
      const fresh = await provider.fetchPositions();
      let changed = await mergeReport(now);

      for (const p of fresh) {
        const state = classify(p, now, cfg);
        const track = tracks.get(p.id);
        if (!track || track.state !== state) {
          tracks.set(p.id, { state, since: p.stateSince ?? now });
        }
        changed = recordSpeed(week, { plate: p.plate, speed: p.speed, at: p.timestamp }, cfg) || changed;
      }

      positions = fresh;
      updatedAt = now;
      error = null;
      if (changed) writeWeek(weekFile, week);
    } catch (err) {
      error = err.message;
      console.error('Eroare GPS:', err.message);
    }
  }

  function snapshot() {
    const now = Date.now();
    const vehicles = positions.map((p) => {
      const state = classify(p, now, cfg);
      const track = tracks.get(p.id);
      const since = state === 'nosignal' ? p.timestamp : track?.since ?? now;
      return {
        id: p.id,
        plate: p.plate,
        type: p.type ?? null,
        lat: p.lat,
        lng: p.lng,
        speed: state === 'moving' ? Math.round(p.speed) : 0,
        heading: p.heading ?? null,
        state,
        since,
      };
    });

    const counts = { moving: 0, idle: 0, off: 0, nosignal: 0 };
    for (const v of vehicles) counts[v.state] += 1;

    const { year, week: weekNumber } = isoWeek(new Date(now));
    const { start, end } = weekBounds(new Date(now));
    const types = new Map(positions.map((p) => [p.plate, p.type ?? null]));
    const items = Object.entries(currentWeek(now).maxes)
      .map(([plate, max]) => ({ plate, type: types.get(plate) ?? null, speed: Math.round(max.speed), at: max.at }))
      .sort((a, b) => b.speed - a.speed)
      .slice(0, cfg.topViteze);

    const idleLongest = vehicles
      .filter((v) => v.state === 'idle')
      .sort((a, b) => a.since - b.since);

    return {
      now,
      source: cfg.furnizor,
      demo: Boolean(provider.isDemo),
      updatedAt,
      error,
      vehicles,
      counts,
      topSpeeds: { year, week: weekNumber, from: start.getTime(), to: end.getTime() - 1, items },
      idleLongest,
    };
  }

  function start() {
    poll();
    setInterval(poll, cfg.actualizareSecunde * 1000);
  }

  return { start, snapshot };
}

module.exports = { createGpsTracker, classify, recordSpeed, weekKey };
