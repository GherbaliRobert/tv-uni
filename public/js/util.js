export const TZ = 'Europe/Bucharest';

let clockOffset = 0;

// Durations use the server's clock, so a TV with a wrong clock still shows them correctly.
export function syncClock(serverNow) {
  clockOffset = serverNow - Date.now();
}
export const now = () => Date.now() + clockOffset;

export const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize);

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

export const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
export const plate = (value) => `<span class="plate">${esc(value)}</span>`;

// Romanian counted nouns: "1 zi", "5 zile", "20 de zile", "101 zile".
export function count(n, one, many) {
  if (n === 1) return `1 ${one}`;
  const rest = n % 100;
  return n > 0 && (rest === 0 || rest >= 20) ? `${n} de ${many}` : `${n} ${many}`;
}

export function fmtDuration(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return count(hours, 'oră', 'ore');
  return count(Math.floor(hours / 24), 'zi', 'zile');
}

const dayMonth = new Intl.DateTimeFormat('ro-RO', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: TZ });
const hourMinute = new Intl.DateTimeFormat('ro-RO', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const shortDay = new Intl.DateTimeFormat('ro-RO', { weekday: 'short', timeZone: TZ });
const shortDate = new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'short', timeZone: TZ });

// Old expiries read better in months or years: "expirat 3 ani", not "expirat 1092 de zile".
export function expiryText(days) {
  if (days === 0) return 'expiră azi';
  if (days === 1) return 'expiră mâine';
  if (days > 0) return `în ${count(days, 'zi', 'zile')}`;
  const overdue = -days;
  if (overdue < 60) return `expirat ${count(overdue, 'zi', 'zile')}`;
  if (overdue < 730) return `expirat ${count(Math.floor(overdue / 30.4), 'lună', 'luni')}`;
  return `expirat ${count(Math.floor(overdue / 365), 'an', 'ani')}`;
}

export const fmtDate = (ms) => dayMonth.format(ms);
export const fmtTime = (ms) => hourMinute.format(ms);
export const fmtShortDate = (ms) => shortDate.format(ms).replace('.', '');

export function fmtDayTime(ms) {
  const day = shortDay.format(ms).replace('.', '');
  return `${day[0].toUpperCase()}${day.slice(1)} ${fmtTime(ms)}`;
}

export const fmtNumber = (n) => new Intl.NumberFormat('ro-RO').format(n);
