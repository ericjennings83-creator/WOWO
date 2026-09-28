export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const money0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function money(n, cents = true) {
  return (cents ? money2 : money0).format(Number(n) || 0);
}

export function num(n, digits = 1) {
  return (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: digits });
}

// Dates are stored as local YYYY-MM-DD strings so they never shift by timezone.
export function isoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function prettyDate(s) {
  if (!s) return '';
  return parseDate(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function shortDate(s) {
  if (!s) return '';
  const d = parseDate(s);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

export function monthKey(s) { return s.slice(0, 7); }

export function monthLabel(key, long = false) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', long ? { month: 'long', year: 'numeric' } : { month: 'short' });
}

// Period ranges for reports. offset 0 = current period, -1 = previous, ...
export function periodRange(kind, offset = 0, today = new Date()) {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let start, end, label;
  if (kind === 'week') {
    start = new Date(t);
    start.setDate(t.getDate() - t.getDay() + offset * 7); // Sunday start
    end = new Date(start);
    end.setDate(start.getDate() + 6);
    label = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  } else if (kind === 'month') {
    start = new Date(t.getFullYear(), t.getMonth() + offset, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    label = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  } else if (kind === 'quarter') {
    const q = Math.floor(t.getMonth() / 3) + offset;
    start = new Date(t.getFullYear(), q * 3, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 3, 0);
    label = `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`;
  } else if (kind === 'year') {
    start = new Date(t.getFullYear() + offset, 0, 1);
    end = new Date(start.getFullYear(), 11, 31);
    label = String(start.getFullYear());
  } else {
    return { start: '0000-01-01', end: '9999-12-31', label: 'All time' };
  }
  return { start: isoDate(start), end: isoDate(end), label };
}
