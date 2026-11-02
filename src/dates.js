const DAY_MS = 86400000;

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Calendar days, so daylight-saving changes don't shift the result.
function daysBetween(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

function weekBounds(date) {
  const start = startOfDay(date);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / DAY_MS + 1) / 7) };
}

function validDate(y, m, d, h = 0, min = 0) {
  const date = new Date(y, m - 1, d, h, min);
  return date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

// Excel stores wall-clock time; exceljs exposes it in the UTC fields of a Date.
function fromExcelDate(value) {
  const v = new Date(value.getTime() + 30000);
  return new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate(), v.getUTCHours(), v.getUTCMinutes());
}

// Accepts real Excel dates, serial numbers and typed text ("15.11.2026", "2026-11-15"). Returns null if unreadable.
function parseDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : fromExcelDate(value);
  if (typeof value === 'number') return fromExcelDate(new Date((value - 25569) * DAY_MS));
  if (typeof value !== 'string') return null;

  const text = value.trim();
  const ro = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (ro) {
    const year = ro[3].length === 2 ? 2000 + Number(ro[3]) : Number(ro[3]);
    return validDate(year, Number(ro[2]), Number(ro[1]), Number(ro[4] || 0), Number(ro[5] || 0));
  }
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (iso) {
    return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]), Number(iso[4] || 0), Number(iso[5] || 0));
  }
  return null;
}

module.exports = { daysBetween, weekBounds, isoWeek, parseDate };
