// Display helpers. Dates from the server are "YYYY-MM-DD" calendar keys, so they are read as plain numbers to
// avoid time-zone shifts. Instants (punch times) are parsed as real dates and shown in the phone's local time.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function dateKeyOf(value: unknown): string | null {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : null;
}

export function instantOf(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseKey(key: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** "2026-11-23" becomes "23 Nov 2026". */
export function formatDateKey(key: string | null | undefined): string {
  if (!key) return '—';
  const p = parseKey(key);
  return p ? `${p.d} ${MONTHS[p.m - 1]} ${p.y}` : key;
}

/** "2026-11-23" becomes "23 Nov". */
export function formatDayMonth(key: string | null | undefined): string {
  if (!key) return '—';
  const p = parseKey(key);
  return p ? `${p.d} ${MONTHS[p.m - 1]}` : key;
}

/** "2026-11" becomes "Nov 2026". */
export function formatCycleKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return key;
  return `${MONTHS[m - 1]} ${y}`;
}

/** Moves a salary-cycle key "YYYY-MM" by whole months. */
export function shiftMonthKey(key: string, delta: number): string {
  let [year, month] = key.split('-').map(Number);
  month += delta;
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** 9:05 AM style, from a local time. */
export function formatTime(d: Date): string {
  let h = d.getHours() % 12;
  if (h === 0) h = 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

/** "23 Nov, 9:05 AM". */
export function formatDateTime(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${formatTime(d)}`;
}

/** "Mon, 23 Nov". */
export function formatLongDate(d: Date): string {
  return `${WEEKDAYS[(d.getDay() + 6) % 7]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "09:30" becomes "9:30 AM". Anything else is returned unchanged. */
export function formatShiftClock(hhmm: string | null | undefined): string {
  if (!hhmm) return '—';
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return hhmm;
  let display = h % 12;
  if (display === 0) display = 12;
  return `${display}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** 1234567 becomes "12,34,567" (Indian grouping). */
export function groupIndian(n: number): string {
  const s = String(Math.abs(n));
  if (s.length <= 3) return (n < 0 ? '-' : '') + s;
  const last3 = s.slice(-3);
  let rest = s.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest.length) parts.unshift(rest);
  return (n < 0 ? '-' : '') + `${parts.join(',')},${last3}`;
}

/** Amounts with the currency symbol, two decimals and Indian grouping. */
export function formatMoney(amount: number, currency: string): string {
  const symbol = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : `${currency} `;
  const [whole, frac] = Math.abs(amount).toFixed(2).split('.');
  return `${amount < 0 ? '-' : ''}${symbol}${groupIndian(Number(whole))}.${frac}`;
}

/** 2 becomes "2", 2.5 becomes "2.5". */
export function formatDays(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** "half_day" becomes "Half day". */
export function humanize(value: string): string {
  const spaced = value.replace(/_/g, ' ').trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : spaced;
}

export function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Money and decimal columns can arrive as strings. Anything that is not a number counts as zero. */
export function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** "Anjali Krishnan" becomes "Anjali". */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** 2026, 11 becomes "Nov 2026". */
export function formatMonthYear(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`;
}
