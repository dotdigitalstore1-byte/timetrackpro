// Pure, dependency-free payroll + time logic. No DB or framework imports so it
// can be unit-tested (see /tests) and reused on server and client.

export type AttendanceStatus = "present" | "late" | "half_day";

export interface PolicyInput {
  shiftStart: string; // "HH:MM" in company local time
  graceMinutes: number;
  lateThresholdMinutes: number;
  timezone: string; // IANA zone, e.g. "Asia/Kolkata"
}

// ---------------------------------------------------------------- time zones

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  minutes: number; // minutes since local midnight
  dow: number; // 0 = Sunday
}

export function localParts(date: Date, tz: string): LocalParts {
  const safeTz = isValidTimezone(tz) ? tz : "UTC";
  const parts = formatter(safeTz).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const wd = get("weekday");
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    dow: dowMap[wd] ?? 0,
  };
}

/** The company-local calendar date of `date`, stored as UTC midnight. */
export function localWorkDate(date: Date, tz: string): Date {
  const p = localParts(date, tz);
  return new Date(Date.UTC(p.year, p.month - 1, p.day));
}

export function parseHHMM(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function dateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidHHMM(v: unknown): v is string {
  return typeof v === "string" && HHMM_RE.test(v);
}

/** Length of a shift in hours (falls back to 8 for an invalid / overnight range). */
export function shiftHours(start: string, end: string): number {
  const m = parseHHMM(end) - parseHHMM(start);
  return m > 0 ? m / 60 : 8;
}

/** Minutes between the work date's local midnight and `date` (handles punches after midnight). */
export function minutesFromWorkDate(date: Date, workDate: Date, tz: string): number {
  const p = localParts(date, tz);
  const days = Math.round((Date.UTC(p.year, p.month - 1, p.day) - workDate.getTime()) / 86400000);
  return days * 1440 + p.minutes;
}

/** Minutes the employee left BEFORE shift end (0 if they stayed until / past it). */
export function earlyLeaveMinutesOf(punchOut: Date, workDate: Date, shiftEnd: string, tz: string): number {
  return Math.max(0, parseHHMM(shiftEnd) - minutesFromWorkDate(punchOut, workDate, tz));
}

/** Raw minutes worked AFTER shift end (0 if they left on time / early). */
export function overtimeMinutesOf(punchOut: Date, workDate: Date, shiftEnd: string, tz: string): number {
  return Math.max(0, minutesFromWorkDate(punchOut, workDate, tz) - parseHHMM(shiftEnd));
}

// ------------------------------------------------------------------ status

export function computeStatus(punchIn: Date, p: PolicyInput): AttendanceStatus {
  const minutes = localParts(punchIn, p.timezone).minutes;
  const start = parseHHMM(p.shiftStart);
  if (minutes <= start + (p.graceMinutes || 0)) return "present";
  if (minutes <= start + (p.lateThresholdMinutes || 0)) return "late";
  return "half_day";
}

// --------------------------------------------------------------- calendars

/** weeklyOff: comma list of JS weekday numbers, e.g. "0,6" or "0". */
export function parseWeeklyOff(value: string | null | undefined): Set<number> {
  const set = new Set<number>();
  for (const part of String(value ?? "0,6").split(",")) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  }
  return set;
}

/** An inclusive date range; both ends are UTC midnights of company-local calendar dates. */
export interface Period {
  start: Date;
  end: Date;
}

export function clampCycleStartDay(n: unknown): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(28, Math.max(1, v)) : 1;
}

/**
 * The pay period for a cycle named by (year, month). A cycle is named after the month it ENDS in.
 *  - startDay 1  : the calendar month (1st → last day)
 *  - startDay 26 : 26th of the previous month → 25th of this month
 */
export function cyclePeriod(year: number, month: number, startDay: number): Period {
  const sd = clampCycleStartDay(startDay);
  if (sd <= 1) return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 0)) };
  return { start: new Date(Date.UTC(year, month - 2, sd)), end: new Date(Date.UTC(year, month - 1, sd - 1)) };
}

/** Which cycle contains `todayLocal` (UTC midnight of the local date)? */
export function currentCycleKey(todayLocal: Date, startDay: number): { year: number; month: number } {
  const sd = clampCycleStartDay(startDay);
  let year = todayLocal.getUTCFullYear();
  let month = todayLocal.getUTCMonth() + 1;
  if (sd > 1 && todayLocal.getUTCDate() >= sd) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return { year, month };
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

export function periodWorkdays(period: Period, weeklyOff: Set<number>, holidays: Set<string> = new Set()): Date[] {
  const out: Date[] = [];
  for (let t = period.start.getTime(); t <= period.end.getTime(); t += 86400000) {
    const d = new Date(t);
    if (weeklyOff.has(d.getUTCDay())) continue;
    if (holidays.has(dateKey(d))) continue;
    out.push(d);
  }
  return out;
}

export function monthWorkdays(
  year: number,
  month: number,
  weeklyOff: Set<number>,
  holidays: Set<string> = new Set()
): Date[] {
  return periodWorkdays(cyclePeriod(year, month, 1), weeklyOff, holidays);
}

export function countWorkdaysBetween(
  start: Date,
  end: Date,
  weeklyOff: Set<number>,
  holidays: Set<string> = new Set()
): number {
  let n = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const d = new Date(t);
    if (!weeklyOff.has(d.getUTCDay()) && !holidays.has(dateKey(d))) n++;
  }
  return n;
}

// ------------------------------------------------------------ month summary

export interface DayRecord {
  status: string; // present | late | half_day | absent | on_leave
  hasPunchIn: boolean;
  hasPunchOut?: boolean; // false = punched in but never punched out (mandatory punch-out rule)
  earlyLeaveMinutes?: number; // minutes left before shift end (recorded at punch-out)
  overtimeMinutes?: number; // raw minutes worked after shift end (recorded at punch-out)
}

/** Company rules that change how recorded days are counted. All optional: omitted = legacy behaviour. */
export interface SummaryRules {
  earlyLeaveGraceMinutes: number; // leaving up to this early is fine
  earlyLeaveHalfDayMinutes: number; // leaving MORE than this early = half day (0 = off)
  overtime?: { minMinutes: number; maxMinutesPerDay: number } | null;
}

export interface MonthSummary {
  presentDays: number; // full-day attendances (incl. late)
  lateDays: number;
  halfDays: number;
  leaveDays: number; // approved leave on workdays
  absentDays: number; // workdays with no punch and no approved leave
  unapprovedOccurrences: Date[]; // first day of each consecutive absent block
  earlyLeaveDays?: number; // full days where the employee left early beyond the grace
  overtimeMinutes?: number; // payable overtime minutes (after min threshold and daily cap)
  weekOffWorkedDays?: number; // days worked on a weekly off (Sunday, etc.): each earns one comp-off
}

/**
 * Walks every workday of the month up to (but not including) `todayLocal`.
 * A workday with no punch-in and no approved leave is "unapproved leave".
 * Consecutive unapproved workdays form ONE occurrence (one hold).
 */
export function summarizeMonth(args: {
  year: number;
  month: number;
  period?: Period; // custom pay period (salary cycle); defaults to the calendar month
  rules?: SummaryRules;
  weeklyOff: Set<number>;
  holidays?: Set<string>;
  records: Map<string, DayRecord>; // key = YYYY-MM-DD
  approvedLeaves: { start: Date; end: Date }[];
  todayLocal: Date; // UTC midnight of today's local date
  joinDate?: Date | null; // UTC midnight; days before are ignored
}): MonthSummary {
  const out: MonthSummary = {
    presentDays: 0,
    lateDays: 0,
    halfDays: 0,
    leaveDays: 0,
    absentDays: 0,
    unapprovedOccurrences: [],
    earlyLeaveDays: 0,
    overtimeMinutes: 0,
    weekOffWorkedDays: 0,
  };
  let inBlock = false;
  const rules = args.rules;
  const period = args.period ?? cyclePeriod(args.year, args.month, 1);

  for (const day of periodWorkdays(period, args.weeklyOff, args.holidays)) {
    if (args.joinDate && day.getTime() < args.joinDate.getTime()) continue;
    const rec = args.records.get(dateKey(day));
    if (rec?.hasPunchIn) {
      inBlock = false;
      // Mandatory punch-out: punched in but no punch-out by the end of that day => half day.
      if (rec.hasPunchOut === false && day.getTime() < args.todayLocal.getTime()) {
        out.halfDays += 1;
        continue;
      }
      const early = rec.earlyLeaveMinutes ?? 0;
      const leftTooEarly = !!rules && rules.earlyLeaveHalfDayMinutes > 0 && early > rules.earlyLeaveHalfDayMinutes;
      if (rec.status === "half_day" || leftTooEarly) out.halfDays += 1;
      else {
        out.presentDays += 1;
        if (rec.status === "late") out.lateDays += 1;
        if (rules && early > rules.earlyLeaveGraceMinutes) out.earlyLeaveDays = (out.earlyLeaveDays ?? 0) + 1;
      }
      const ot = rec.overtimeMinutes ?? 0;
      if (rules?.overtime && ot > 0 && ot >= rules.overtime.minMinutes) {
        out.overtimeMinutes = (out.overtimeMinutes ?? 0) + Math.min(ot, rules.overtime.maxMinutesPerDay);
      }
      continue;
    }
    // A half day entered directly (no punches) is still a half day, never an absence.
    if (rec?.status === "half_day") {
      inBlock = false;
      out.halfDays += 1;
      continue;
    }
    const onLeave = args.approvedLeaves.some(
      (l) => day.getTime() >= l.start.getTime() && day.getTime() <= l.end.getTime()
    );
    if (onLeave) {
      inBlock = false;
      out.leaveDays += 1;
      continue;
    }
    if (day.getTime() >= args.todayLocal.getTime()) continue; // future / today: not absent yet
    out.absentDays += 1;
    if (!inBlock) {
      out.unapprovedOccurrences.push(day);
      inBlock = true;
    }
  }

  // Half days recorded on a weekly off or a holiday are real half days: they deduct and show in the counts.
  // (Full-day work on those days is not counted here; it earns comp-off below.)
  const holidaySet = args.holidays ?? new Set<string>();
  for (let t = period.start.getTime(); t <= period.end.getTime(); t += 86400000) {
    const d = new Date(t);
    const isOff = args.weeklyOff.has(d.getUTCDay()) || holidaySet.has(dateKey(d));
    if (!isOff) continue;
    if (args.joinDate && d.getTime() < args.joinDate.getTime()) continue;
    const rec = args.records.get(dateKey(d));
    if (!rec) continue;
    const missingOut = rec.hasPunchIn && rec.hasPunchOut === false && d.getTime() < args.todayLocal.getTime();
    if (rec.status === "half_day" || missingOut) out.halfDays += 1;
  }

  // Work done on a weekly off (Sunday by default) earns one comp-off credit per day.
  for (let t = period.start.getTime(); t <= period.end.getTime(); t += 86400000) {
    const d = new Date(t);
    if (!args.weeklyOff.has(d.getUTCDay())) continue;
    if (args.joinDate && d.getTime() < args.joinDate.getTime()) continue;
    if (args.records.get(dateKey(d))?.hasPunchIn) out.weekOffWorkedDays = (out.weekOffWorkedDays ?? 0) + 1;
  }
  return out;
}

/**
 * Status shown to people and used for reporting. A day with a punch-in but no punch-out is a half day once
 * that day has ended (the punch-out is mandatory). Today is left alone until the day is over.
 */
export function effectiveStatus(
  rec: { status: string; hasPunchIn: boolean; hasPunchOut?: boolean },
  workDate: Date,
  todayLocal: Date
): string {
  if (rec.hasPunchIn && rec.hasPunchOut === false && workDate.getTime() < todayLocal.getTime()) return "half_day";
  return rec.status;
}

// ------------------------------------------------------------- leave accrual

export type LeaveAccrualMode = "carry" | "lapse";

/**
 * Leave accrues one day per calendar month, starting with the employee's joining month.
 *  - accrued:   months employed so far this calendar year, capped at the annual maximum
 *  - thisMonth: the single leave granted for the current month (0 if not yet employed)
 * Under "lapse" only thisMonth is spendable; under "carry" the whole accrued balance is.
 */
export function leaveCredits(args: { joinDate: Date | null; today: Date; annualCap: number }): {
  accrued: number;
  thisMonth: number;
} {
  const y = args.today.getUTCFullYear();
  const m = args.today.getUTCMonth();
  let startMonth = 0;
  if (args.joinDate) {
    const jy = args.joinDate.getUTCFullYear();
    const jm = args.joinDate.getUTCMonth();
    if (jy > y || (jy === y && jm > m)) return { accrued: 0, thisMonth: 0 };
    if (jy === y) startMonth = jm;
  }
  const cap = Math.max(0, Math.round(args.annualCap));
  const months = m - startMonth + 1;
  return { accrued: Math.min(months, cap), thisMonth: cap > 0 ? 1 : 0 };
}

// ------------------------------------------------------------ photo retention

/** Punch photos are kept this many days (by work date), then deleted. */
export const PHOTO_RETENTION_DAYS = 45;

/** Photos for work dates before this (local UTC-midnight date) are due for deletion. */
export function photoCutoff(todayLocal: Date): Date {
  return addDays(todayLocal, -PHOTO_RETENTION_DAYS);
}

// ------------------------------------------------------------------- salary

export interface DeductionRule {
  type: "percentage" | "fixed";
  value: number;
}

/** Every month is treated as this many days, so the daily rate never depends on the calendar. */
export const SALARY_BASE_DAYS = 30;

export interface SalaryInput {
  basicSalary: number;
  workDaysPerMonth: number; // divisor for the daily rate; the standard is SALARY_BASE_DAYS (30)
  summary: MonthSummary;
  lateRule: DeductionRule; // per late day
  halfDayRule: DeductionRule; // per half day
  leaveRule: DeductionRule; // per UNPAID approved leave day (leave covered by comp-off is not deducted)
  holdDaysPerOccurrence: number;
  releasedHoldCount: number; // occurrences whose hold has been released
  otherDeductions: { label: string; amount: number }[];
  // --- optional company rules (omitted = no effect) ---
  earlyLeaveRule?: DeductionRule; // per early-leave day
  lateMarks?: { limit: number; penaltyDays: number }; // every `limit` late days costs `penaltyDays` of salary
  overtime?: { rate: number }; // pay multiplier, e.g. 1.5
  shiftHours?: number; // employee's shift length, for the hourly rate
  additions?: { label: string; amount: number }[]; // bonuses / allowances for this cycle
  extraPay?: { enabled: boolean; rate: number }; // pay for comp-off nobody used by the end of the cycle
}

export interface SalaryResult {
  dailyRate: number;
  attendanceSalary: number; // basic minus unpaid (unapproved absent) days
  lateDeduction: number;
  lateMarksDeduction: number; // extra penalty from the "every N late marks" rule
  earlyLeaveDeduction: number;
  halfDayDeduction: number;
  leaveDeduction: number;
  otherTotal: number;
  overtimePay: number;
  additionsTotal: number;
  totalDeductions: number; // permanent deductions only (holds are separate)
  holdDays: number; // ACTIVE hold days
  holdAmount: number; // ACTIVE hold amount (temporary, releasable)
  netBeforeHold: number;
  netPayable: number; // payable now = net before hold - active holds
  // --- weekly-off work and comp-off
  weekOffWorkedDays: number; // days worked on a weekly off; each earns one comp-off
  compOffUsed: number; // approved leave days covered by comp-off in this cycle (paid, not deducted)
  compOffUnused: number; // comp-off left when the cycle ends
  unpaidLeaveDays: number; // approved leave days still deducted
  extraPayDays: number; // unused comp-off that is paid as extra pay
  extraPay: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function perUnit(rule: DeductionRule, dailyRate: number): number {
  return rule.type === "fixed" ? rule.value : (dailyRate * rule.value) / 100;
}

export function computeSalary(i: SalaryInput): SalaryResult {
  const divisor = i.workDaysPerMonth > 0 ? i.workDaysPerMonth : SALARY_BASE_DAYS;
  const dailyRate = i.basicSalary / divisor;
  const s = i.summary;

  const attendanceSalary = Math.max(0, i.basicSalary - s.absentDays * dailyRate);
  const lateDeduction = s.lateDays * perUnit(i.lateRule, dailyRate);
  const lateMarksDeduction =
    i.lateMarks && i.lateMarks.limit > 0
      ? Math.floor(s.lateDays / i.lateMarks.limit) * i.lateMarks.penaltyDays * dailyRate
      : 0;
  const earlyLeaveDeduction = i.earlyLeaveRule ? (s.earlyLeaveDays ?? 0) * perUnit(i.earlyLeaveRule, dailyRate) : 0;
  const hourlyRate = dailyRate / (i.shiftHours && i.shiftHours > 0 ? i.shiftHours : 8);
  const overtimePay = i.overtime ? ((s.overtimeMinutes ?? 0) / 60) * hourlyRate * i.overtime.rate : 0;
  const additionsTotal = (i.additions ?? []).reduce((t, a) => t + Number(a.amount || 0), 0);

  // Comp-off: each day worked on a weekly off earns one day that must be used in the same cycle.
  // Approved leave in the cycle is covered by comp-off first (those days are paid); only the rest is deducted.
  const weekOffWorkedDays = s.weekOffWorkedDays ?? 0;
  const compOffUsed = Math.min(s.leaveDays, weekOffWorkedDays);
  const compOffUnused = weekOffWorkedDays - compOffUsed;
  const unpaidLeaveDays = s.leaveDays - compOffUsed;
  const extraPayDays = i.extraPay?.enabled ? compOffUnused : 0;
  const extraPay = extraPayDays * dailyRate * (i.extraPay?.rate ?? 1);

  const halfDayDeduction = s.halfDays * perUnit(i.halfDayRule, dailyRate);
  const leaveDeduction = unpaidLeaveDays * perUnit(i.leaveRule, dailyRate);
  const otherTotal = i.otherDeductions.reduce((t, d) => t + Number(d.amount || 0), 0);
  const totalDeductions =
    lateDeduction + lateMarksDeduction + earlyLeaveDeduction + halfDayDeduction + leaveDeduction + otherTotal;

  const activeOccurrences = Math.max(0, s.unapprovedOccurrences.length - i.releasedHoldCount);
  const holdDays = activeOccurrences * i.holdDaysPerOccurrence;
  const holdAmount = holdDays * dailyRate;

  const netBeforeHold = Math.max(0, attendanceSalary + overtimePay + additionsTotal + extraPay - totalDeductions);
  const netPayable = Math.max(0, netBeforeHold - holdAmount);

  return {
    dailyRate: r2(dailyRate),
    attendanceSalary: r2(attendanceSalary),
    lateDeduction: r2(lateDeduction),
    lateMarksDeduction: r2(lateMarksDeduction),
    earlyLeaveDeduction: r2(earlyLeaveDeduction),
    halfDayDeduction: r2(halfDayDeduction),
    leaveDeduction: r2(leaveDeduction),
    otherTotal: r2(otherTotal),
    overtimePay: r2(overtimePay),
    additionsTotal: r2(additionsTotal),
    totalDeductions: r2(totalDeductions),
    holdDays,
    holdAmount: r2(holdAmount),
    netBeforeHold: r2(netBeforeHold),
    netPayable: r2(netPayable),
    weekOffWorkedDays,
    compOffUsed,
    compOffUnused,
    unpaidLeaveDays,
    extraPayDays,
    extraPay: r2(extraPay),
  };
}

/** The salary cycle containing `today`, then the previous `count - 1` cycles (newest first). */
export function recentCycles(
  todayLocal: Date,
  startDay: number,
  count: number
): { year: number; month: number; key: string; start: Date; end: Date }[] {
  const out: { year: number; month: number; key: string; start: Date; end: Date }[] = [];
  let { year, month } = currentCycleKey(todayLocal, startDay);
  for (let i = 0; i < count; i++) {
    const p = cyclePeriod(year, month, startDay);
    out.push({ year, month, key: `${year}-${String(month).padStart(2, "0")}`, start: p.start, end: p.end });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}
