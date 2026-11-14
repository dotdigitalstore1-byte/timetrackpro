// Pure, dependency-free notice-period rules. Dates are company-local calendar days as "YYYY-MM-DD" strings,
// so no timezone shift can creep in. Used by the API (server) and the Notice page (client).

export const NOTICE_STATUSES = ["requested", "active", "rejected", "cancelled", "completed"] as const;
export type NoticeStatus = (typeof NOTICE_STATUSES)[number];

/** Requests that still block a second notice for the same employee. */
export const OPEN_NOTICE_STATUSES: NoticeStatus[] = ["requested", "active"];

/** Hard limits for the number of notice days, whatever the company policy says. */
export const NOTICE_DAYS_MIN = 1;
export const NOTICE_DAYS_MAX = 365;

const DAY_MS = 86400000;
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = KEY_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const check = new Date(t);
  return check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d;
}

function keyToTime(key: string): number {
  const m = KEY_RE.exec(key)!;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function timeToKey(t: number): string {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The calendar day `n` days after `key` (n may be negative). */
export function addDayKey(key: string, n: number): string {
  return timeToKey(keyToTime(key) + n * DAY_MS);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function diffDayKeys(from: string, to: string): number {
  return Math.round((keyToTime(to) - keyToTime(from)) / DAY_MS);
}

/**
 * Last working day of a notice. A notice of N days that starts on day S covers S … S+N-1 inclusive,
 * so the last working day is S + (N - 1). A 30-day notice starting 1 Nov ends on 30 Nov.
 */
export function lastWorkingDayOf(startKey: string, noticeDays: number): string {
  return addDayKey(startKey, noticeDays - 1);
}

/** Notice days must be a whole number inside the policy's maximum and the hard limits. */
export function validNoticeDays(value: unknown, maxDays: number): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) return null;
  const max = Math.min(NOTICE_DAYS_MAX, Math.max(NOTICE_DAYS_MIN, maxDays));
  if (n < NOTICE_DAYS_MIN || n > max) return null;
  return n;
}

/** Where a notice stands today: not started, being served, or finished. */
export type NoticePhase = "upcoming" | "serving" | "ended";

export function noticePhase(startKey: string, lastKey: string, todayKey: string): { phase: NoticePhase; daysLeft: number } {
  if (todayKey < startKey) return { phase: "upcoming", daysLeft: diffDayKeys(todayKey, lastKey) + 1 };
  if (todayKey <= lastKey) return { phase: "serving", daysLeft: diffDayKeys(todayKey, lastKey) + 1 };
  return { phase: "ended", daysLeft: 0 };
}

/**
 * Digital signature check: the typed name must match the account's full name, ignoring case, extra spaces
 * and punctuation. This is a deliberate, recorded confirmation, not a cryptographic signature.
 */
export function signatureMatches(typed: unknown, fullName: string): boolean {
  const norm = (s: string) =>
    s
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  if (typeof typed !== "string") return false;
  const a = norm(typed);
  const b = norm(fullName);
  return a.length > 0 && a === b;
}
