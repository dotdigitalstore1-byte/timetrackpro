// Pure, dependency-free payroll + time logic. No DB or framework imports so it
// can be unit-tested (see /tests) and reused on server and client.

export type AttendanceStatus = "present" | "late" | "half_day";

/** A punch can also be recorded as "absent" when it comes after the late-percentage cut-off (see absentCutoffMinutes). */
export type PunchStatus = AttendanceStatus | "absent";

export interface PolicyInput {
  shiftStart: string; // "HH:MM" in company local time
  shiftEnd?: string | null; // "HH:MM"; needed for the late-percentage rule
  graceMinutes: number;
  lateThresholdMinutes: number;
  timezone: string; // IANA zone, e.g. "Asia/Kolkata"
  /** Late-percentage rule: punching in after this % of the shift has passed marks the day absent. null/0 = off. */
  absentAfterPercent?: number | null;
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

/**
 * The clock time (minutes since midnight) after which a punch-in marks the day absent under the
 * late-percentage rule, or null when the rule is off. Example: 09:00–18:00 at 50% gives 13:30.
 */
export function absentCutoffMinutes(shiftStart: string, shiftEnd: string | null | undefined, percent: number | null | undefined): number | null {
  if (!percent || percent <= 0 || !shiftEnd) return null;
  const start = parseHHMM(shiftStart);
  const length = parseHHMM(shiftEnd) - start;
  if (length <= 0) return null;
  return start + (length * Math.min(100, percent)) / 100;
}

export function computeStatus(punchIn: Date, p: PolicyInput): PunchStatus {
  const minutes = localParts(punchIn, p.timezone).minutes;
  const start = parseHHMM(p.shiftStart);
  const cutoff = absentCutoffMinutes(p.shiftStart, p.shiftEnd, p.absentAfterPercent);
  if (cutoff !== null && minutes > cutoff) return "absent";
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
  punchInMinutes?: number | null; // company-clock minutes since midnight of the punch-in (for the deduction log)
  punchOutMinutes?: number | null;
}

/** Why a day counted as a half day. */
export type HalfDayCause = "cutoff" | "left_early" | "no_punch_out" | "manual";

/**
 * One day that changes pay, as classified by summarizeMonth. The totals and the day-wise deduction log are both
 * built from these, so the two can never disagree.
 */
export interface DayEvent {
  date: Date; // UTC midnight of the work date
  offDay: boolean; // weekly off or company holiday
  lateDay: boolean;
  halfDay: boolean;
  halfDayCause?: HalfDayCause;
  earlyLeave: boolean;
  absent: boolean; // unapproved absence: no punch and no approved leave
  autoAbsent: boolean; // absent because the punch-in came after the late-percentage cut-off
  leave: boolean; // approved leave on a workday
  punchInMinutes: number | null;
  punchOutMinutes: number | null;
  earlyLeaveMinutes: number;
}

export interface MonthSummary {
  presentDays: number; // full-day attendances (incl. late)
  lateDays: number;
  halfDays: number;
  leaveDays: number; // approved leave on workdays
  absentDays: number; // unapproved days: workdays with no punch and no approved leave (one per day)
  unapprovedOccurrences: Date[]; // first day of each run of consecutive unapproved days
  unapprovedRunLengths: number[]; // number of unapproved days in each run, parallel to unapprovedOccurrences
  earlyLeaveDays?: number; // full days where the employee left early beyond the grace
  overtimeMinutes?: number; // payable overtime minutes (after min threshold and daily cap)
  weekOffWorkedDays?: number; // days worked on a weekly off (Sunday, etc.): each earns one comp-off
  events: DayEvent[]; // every day that changes pay, in date order
}

/** Company rules that change how recorded days are counted. All optional: omitted = legacy behaviour. */
export interface SummaryRules {
  earlyLeaveGraceMinutes: number; // leaving up to this early is fine
  earlyLeaveHalfDayMinutes: number; // leaving MORE than this early = half day (0 = off)
  overtime?: { minMinutes: number; maxMinutesPerDay: number } | null;
}

/**
 * Walks every workday of the period up to (but not including) `todayLocal`.
 * A workday with no punch-in and no approved leave is an unapproved day. Consecutive unapproved workdays form ONE
 * run (one salary-hold occurrence); every day in the run counts once in absentDays.
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
    unapprovedRunLengths: [],
    earlyLeaveDays: 0,
    overtimeMinutes: 0,
    weekOffWorkedDays: 0,
    events: [],
  };
  let inBlock = false;
  const rules = args.rules;
  const period = args.period ?? cyclePeriod(args.year, args.month, 1);
  const holidaySet = args.holidays ?? new Set<string>();
  const isOff = (d: Date) => args.weeklyOff.has(d.getUTCDay()) || holidaySet.has(dateKey(d));
  const note = (day: Date, rec: DayRecord | undefined, e: Partial<DayEvent>) => {
    out.events.push({
      date: day,
      offDay: isOff(day),
      lateDay: false,
      halfDay: false,
      earlyLeave: false,
      absent: false,
      autoAbsent: false,
      leave: false,
      punchInMinutes: rec?.punchInMinutes ?? null,
      punchOutMinutes: rec?.punchOutMinutes ?? null,
      earlyLeaveMinutes: rec?.earlyLeaveMinutes ?? 0,
      ...e,
    });
  };

  for (const day of periodWorkdays(period, args.weeklyOff, args.holidays)) {
    if (args.joinDate && day.getTime() < args.joinDate.getTime()) continue;
    const rec = args.records.get(dateKey(day));
    // A punch recorded as "absent" (late-percentage rule) is an absence, exactly like no punch at all.
    if (rec?.hasPunchIn && rec.status !== "absent") {
      inBlock = false;
      // Mandatory punch-out: punched in but no punch-out by the end of that day => half day.
      if (rec.hasPunchOut === false && day.getTime() < args.todayLocal.getTime()) {
        out.halfDays += 1;
        note(day, rec, { halfDay: true, halfDayCause: "no_punch_out" });
        continue;
      }
      const early = rec.earlyLeaveMinutes ?? 0;
      const leftTooEarly = !!rules && rules.earlyLeaveHalfDayMinutes > 0 && early > rules.earlyLeaveHalfDayMinutes;
      if (rec.status === "half_day" || leftTooEarly) {
        out.halfDays += 1;
        note(day, rec, { halfDay: true, halfDayCause: rec.status === "half_day" ? "cutoff" : "left_early" });
      } else {
        out.presentDays += 1;
        if (rec.status === "late") out.lateDays += 1;
        const isEarly = !!rules && early > rules.earlyLeaveGraceMinutes;
        if (isEarly) out.earlyLeaveDays = (out.earlyLeaveDays ?? 0) + 1;
        if (rec.status === "late" || isEarly) note(day, rec, { lateDay: rec.status === "late", earlyLeave: isEarly });
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
      note(day, rec, { halfDay: true, halfDayCause: "manual" });
      continue;
    }
    const onLeave = args.approvedLeaves.some(
      (l) => day.getTime() >= l.start.getTime() && day.getTime() <= l.end.getTime()
    );
    if (onLeave) {
      inBlock = false;
      out.leaveDays += 1;
      note(day, rec, { leave: true });
      continue;
    }
    if (day.getTime() >= args.todayLocal.getTime()) continue; // future / today: not absent yet
    out.absentDays += 1;
    note(day, rec, { absent: true, autoAbsent: !!rec?.hasPunchIn });
    if (!inBlock) {
      out.unapprovedOccurrences.push(day);
      out.unapprovedRunLengths.push(1);
      inBlock = true;
    } else {
      out.unapprovedRunLengths[out.unapprovedRunLengths.length - 1] += 1;
    }
  }

  // Half days recorded on a weekly off or a holiday are real half days: they deduct and show in the counts.
  // (Full-day work on those days is not counted here; it earns comp-off below.)
  for (let t = period.start.getTime(); t <= period.end.getTime(); t += 86400000) {
    const d = new Date(t);
    if (!isOff(d)) continue;
    if (args.joinDate && d.getTime() < args.joinDate.getTime()) continue;
    const rec = args.records.get(dateKey(d));
    if (!rec) continue;
    const missingOut = rec.hasPunchIn && rec.hasPunchOut === false && d.getTime() < args.todayLocal.getTime();
    if (rec.status === "half_day" || missingOut) {
      out.halfDays += 1;
      note(d, rec, {
        halfDay: true,
        halfDayCause: missingOut ? "no_punch_out" : rec.hasPunchIn ? "cutoff" : "manual",
      });
    }
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

/**
 * Attendance rows (times, status, GPS, no photo) are kept this many days by work date, then deleted.
 * Payroll for finalized cycles is stored in salary_records, so it is not affected.
 */
export const RECORD_RETENTION_DAYS = 90;

/** Attendance rows for work dates before this are deleted. */
export function recordCutoff(todayLocal: Date): Date {
  return addDays(todayLocal, -RECORD_RETENTION_DAYS);
}

/** An employee can download an approved salary slip for this many days after the admin approves the request. */
export const SLIP_ACCESS_DAYS = 90;

// ------------------------------------------------------------------- salary

export interface DeductionRule {
  type: "percentage" | "fixed";
  value: number;
}

/** Every month is treated as this many days, so the daily rate never depends on the calendar. */
export const SALARY_BASE_DAYS = 30;

/** The salary date when the company has not chosen one: the 5th of the month after the cycle ends. */
export const DEFAULT_SALARY_DISBURSEMENT_DAY = 5;

export interface SalaryInput {
  basicSalary: number;
  workDaysPerMonth: number; // divisor for the daily rate; the standard is SALARY_BASE_DAYS (30)
  summary: MonthSummary;
  lateRule: DeductionRule; // per late day
  halfDayRule: DeductionRule; // per half day
  leaveRule: DeductionRule; // per UNPAID approved leave day (leave covered by comp-off is not deducted)
  holdDelayDays?: number; // ACTIVE salary-hold delay in days (0 when the hold rule is off or every run is released)
  otherDeductions: { label: string; amount: number }[];
  // --- optional company rules (omitted = no effect) ---
  earlyLeaveRule?: DeductionRule; // per early-leave day
  lateMarks?: { limit: number; penaltyDays: number }; // every `limit` late days costs `penaltyDays` of salary
  overtime?: { rate: number }; // pay multiplier, e.g. 1.5
  shiftHours?: number; // employee's shift length, for the hourly rate
  additions?: { label: string; amount: number }[]; // bonuses / allowances for this cycle
  extraPay?: { enabled: boolean; rate: number }; // pay for comp-off nobody used by the end of the cycle
  holidayDeductionDays?: number; // Sunday / holiday days cut for unauthorized leave around them (see holidayDeductionBlocks)
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
  totalDeductions: number; // permanent deductions only (the salary hold is not a deduction)
  holdDays: number; // ACTIVE salary-hold delay: the disbursement date moves this many days after the salary date
  holdAmount: number; // always 0. Money holds were replaced by the date delay; kept so finalized history reads correctly
  netBeforeHold: number; // same as netPayable (kept for existing readers)
  netPayable: number; // paid in full, on the disbursement date
  // --- weekly-off work and comp-off
  weekOffWorkedDays: number; // days worked on a weekly off; each earns one comp-off
  compOffUsed: number; // approved leave days covered by comp-off in this cycle (paid, not deducted)
  compOffUnused: number; // comp-off left when the cycle ends
  unpaidLeaveDays: number; // approved leave days still deducted
  extraPayDays: number; // unused comp-off that is paid as extra pay
  extraPay: number;
  holidayDeductionDays: number; // Sunday / holiday days cut in this cycle
  holidayDeduction: number; // amount of those days (daily rate each)
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
  // Sunday / holiday pay is cut one daily rate per triggered block (0 unless the company rule is on).
  const cutDays = Math.max(0, i.holidayDeductionDays ?? 0);
  const holidayDeduction = cutDays * dailyRate;
  const otherTotal = i.otherDeductions.reduce((t, d) => t + Number(d.amount || 0), 0);
  const totalDeductions =
    lateDeduction + lateMarksDeduction + earlyLeaveDeduction + halfDayDeduction + leaveDeduction + holidayDeduction + otherTotal;

  // The salary hold no longer withholds money: it delays the disbursement date (see holdDelayDaysOf).
  const holdDays = Math.max(0, Math.round(i.holdDelayDays ?? 0));
  const netBeforeHold = Math.max(0, attendanceSalary + overtimePay + additionsTotal + extraPay - totalDeductions);

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
    holdAmount: 0,
    netBeforeHold: r2(netBeforeHold),
    netPayable: r2(netBeforeHold),
    weekOffWorkedDays,
    compOffUsed,
    compOffUnused,
    unpaidLeaveDays,
    extraPayDays,
    extraPay: r2(extraPay),
    holidayDeductionDays: cutDays,
    holidayDeduction: r2(holidayDeduction),
  };
}

// ------------------------------------------------------------ salary date & hold

/**
 * The salary date of a cycle: the chosen day of the month AFTER the cycle ends (a cycle is named after the month
 * it ends in). Example: the Nov cycle with day 5 is paid on 5 Dec. Days are limited to 1–28, which every month has.
 */
export function salaryDateOf(year: number, month: number, day: number): Date {
  const d = Math.min(28, Math.max(1, Math.round(Number(day)) || DEFAULT_SALARY_DISBURSEMENT_DAY));
  return new Date(Date.UTC(year, month, d)); // month is 1-based, so this lands in the following month
}

/**
 * Days the salary hold adds to the disbursement date: every unapproved day in an active (not released) run,
 * times the delay per unapproved day. Example with 2 days per day: 1 day -> 2, 2 days -> 4, 3 days -> 6.
 * Returns 0 when the hold rule is switched off.
 */
export function holdDelayDaysOf(
  runs: { unapprovedDays: number; released: boolean }[],
  delayPerDay: number,
  enabled: boolean
): number {
  if (!enabled) return 0;
  const per = Math.max(0, Math.round(Number(delayPerDay) || 0));
  return runs.reduce((t, r) => (r.released ? t : t + Math.max(0, r.unapprovedDays) * per), 0);
}

// ------------------------------------------------------------ deduction log

export type DeductionKind =
  | "late"
  | "late_marks"
  | "early_leave"
  | "half_day"
  | "unpaid_leave"
  | "unapproved_absence"
  | "holiday_cut"
  | "manual"
  | "comp_off_covered";

/**
 * One line of the day-wise deduction log, shown to admins and employees. `amount` is the rupees taken off that day.
 * `comp_off_covered` lines are 0: they explain an approved leave day that was paid by comp-off, so nothing was taken.
 */
export interface LedgerEntry {
  date: string | null; // YYYY-MM-DD; null for manual deductions, which have no date
  kind: DeductionKind;
  reason: string;
  amount: number;
}

export interface LedgerInput {
  summary: MonthSummary;
  dailyRate: number;
  lateRule: DeductionRule;
  halfDayRule: DeductionRule;
  leaveRule: DeductionRule;
  earlyLeaveRule?: DeductionRule;
  lateMarks?: { limit: number; penaltyDays: number };
  compOffUsed: number; // approved-leave days paid by comp-off (the earliest leave days of the cycle)
  holidayBlocks: Date[]; // first day of each Sunday / holiday block that is cut
  otherDeductions: { label: string; amount: number }[];
}

/** HH:MM on the company clock, or a dash when the time is not known. */
export function clockText(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  const h = Math.floor(minutes / 60) % 24;
  return `${String(h).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function halfDayReason(e: DayEvent): string {
  const prefix = e.offDay ? "Half day on a weekly off or holiday: " : "Half day: ";
  switch (e.halfDayCause) {
    case "cutoff":
      return `${prefix}punched in at ${clockText(e.punchInMinutes)}, after the half-day cut-off`;
    case "left_early":
      return `${prefix}left at ${clockText(e.punchOutMinutes)}, earlier than the allowed limit`;
    case "no_punch_out":
      return `${prefix}punched in at ${clockText(e.punchInMinutes)} but no punch-out was recorded`;
    default:
      return `${prefix}entered by admin`;
  }
}

/**
 * Builds the day-wise deduction log from the same day classification as the totals. Summing the amounts gives
 * the absent days at one daily rate each, plus total deductions. Dated lines come first in date order; manual
 * deductions (which have no date) come last.
 */
export function buildDeductionLedger(i: LedgerInput): LedgerEntry[] {
  const unit = (rule: DeductionRule) => perUnit(rule, i.dailyRate);
  const lateStep = i.lateMarks && i.lateMarks.limit > 0 ? i.lateMarks.limit : 0;
  const penaltyEach = (i.lateMarks?.penaltyDays ?? 0) * i.dailyRate;
  const out: LedgerEntry[] = [];
  const events = [...(i.summary.events ?? [])].sort((a, b) => a.date.getTime() - b.date.getTime());
  let lateCount = 0;
  let leaveCount = 0;

  for (const e of events) {
    const date = dateKey(e.date);
    if (e.absent) {
      out.push({
        date,
        kind: "unapproved_absence",
        reason: e.autoAbsent
          ? `Auto-absent: punched in at ${clockText(e.punchInMinutes)}, after the late-percentage cut-off`
          : "Unapproved absence: no punch and no approved leave",
        amount: i.dailyRate,
      });
    }
    if (e.leave) {
      leaveCount += 1;
      if (leaveCount <= i.compOffUsed) {
        out.push({ date, kind: "comp_off_covered", reason: "Approved leave paid by comp-off, not deducted", amount: 0 });
      } else {
        out.push({ date, kind: "unpaid_leave", reason: "Approved leave not covered by comp-off", amount: unit(i.leaveRule) });
      }
    }
    if (e.halfDay) {
      out.push({ date, kind: "half_day", reason: halfDayReason(e), amount: unit(i.halfDayRule) });
    }
    if (e.lateDay) {
      lateCount += 1;
      out.push({
        date,
        kind: "late",
        reason: `Late arrival: punched in at ${clockText(e.punchInMinutes)}, after the cool-off`,
        amount: unit(i.lateRule),
      });
      if (lateStep > 0 && penaltyEach > 0 && lateCount % lateStep === 0) {
        out.push({
          date,
          kind: "late_marks",
          reason: `Late marks: late day ${lateCount}, every ${lateStep} late days cost ${i.lateMarks?.penaltyDays} day(s) of salary`,
          amount: penaltyEach,
        });
      }
    }
    if (e.earlyLeave && i.earlyLeaveRule && unit(i.earlyLeaveRule) > 0) {
      out.push({
        date,
        kind: "early_leave",
        reason: `Early leave: left at ${clockText(e.punchOutMinutes)}, ${e.earlyLeaveMinutes} min before shift end`,
        amount: unit(i.earlyLeaveRule),
      });
    }
  }

  for (const b of i.holidayBlocks) {
    out.push({
      date: dateKey(b),
      kind: "holiday_cut",
      reason: "Sunday / holiday pay cut: unauthorized leave around this weekly off or holiday",
      amount: i.dailyRate,
    });
  }
  for (const d of i.otherDeductions) {
    out.push({ date: null, kind: "manual", reason: d.label, amount: Number(d.amount) || 0 });
  }

  return out
    .map((x) => ({ ...x, amount: r2(x.amount) }))
    .sort((a, b) => (a.date === null ? 1 : 0) - (b.date === null ? 1 : 0) || (a.date ?? "").localeCompare(b.date ?? ""));
}

/** Everything needed to decide whether a day is an unauthorized absence. Days outside [loadedStart, loadedEnd] are unknown. */
export interface AbsenceContext {
  weeklyOff: Set<number>;
  holidays: Set<string>;
  records: Map<string, DayRecord>;
  approvedLeaves: { start: Date; end: Date }[];
  todayLocal: Date;
  joinDate?: Date | null;
  loadedStart: Date;
  loadedEnd: Date;
}

const DAY_MS = 86400000;

/**
 * True for a working day that has already passed with no punch, no half-day record and no approved leave.
 * Mirrors the absence rule in summarizeMonth, so the two can never disagree.
 */
export function isUnauthorizedAbsence(day: Date, a: AbsenceContext): boolean {
  const t = day.getTime();
  if (t < a.loadedStart.getTime() || t > a.loadedEnd.getTime()) return false;
  if (a.weeklyOff.has(day.getUTCDay()) || a.holidays.has(dateKey(day))) return false;
  if (a.joinDate && t < a.joinDate.getTime()) return false;
  if (t >= a.todayLocal.getTime()) return false;
  const rec = a.records.get(dateKey(day));
  if ((rec?.hasPunchIn && rec.status !== "absent") || rec?.status === "half_day") return false;
  return !a.approvedLeaves.some((l) => t >= l.start.getTime() && t <= l.end.getTime());
}

/**
 * Sunday / holiday pay cut. A block of consecutive non-working days (weekly offs and company holidays together,
 * e.g. Sat + Sun + Mon holiday) is cut by ONE day's pay when, among the working days directly before and after
 * the block, at least `triggerCount` (1 or 2) are unauthorized absences. Any punch inside the block cancels the cut.
 * A block belongs to the cycle that contains its first day, so nothing is counted twice across cycles.
 */
export function holidayDeductionBlocks(period: Period, a: AbsenceContext, triggerCount: number): Date[] {
  const need = Math.min(2, Math.max(1, Math.round(triggerCount) || 1));
  const isOff = (t: number) => {
    const d = new Date(t);
    return a.weeklyOff.has(d.getUTCDay()) || a.holidays.has(dateKey(d));
  };
  const MAX_BLOCK_DAYS = 60; // safety stop for pathological calendars
  const blocks: Date[] = [];

  for (let t = period.start.getTime(); t <= period.end.getTime(); t += DAY_MS) {
    if (!isOff(t) || isOff(t - DAY_MS)) continue; // only the first day of each block
    let end = t;
    for (let steps = 0; steps < MAX_BLOCK_DAYS && isOff(end + DAY_MS); steps++) end += DAY_MS;

    let worked = false;
    for (let x = t; x <= end; x += DAY_MS) {
      const r = a.records.get(dateKey(new Date(x)));
      if (r?.hasPunchIn && r.status !== "absent") {
        worked = true;
        break;
      }
    }
    if (worked) continue;
    if (a.joinDate && end < a.joinDate.getTime()) continue;

    const unauthorized =
      (isUnauthorizedAbsence(new Date(t - DAY_MS), a) ? 1 : 0) +
      (isUnauthorizedAbsence(new Date(end + DAY_MS), a) ? 1 : 0);
    if (unauthorized >= need) blocks.push(new Date(t));
  }
  return blocks;
}

/** How many Sunday / holiday cuts the period has (one daily rate each). */
export function holidayDeductionDays(period: Period, a: AbsenceContext, triggerCount: number): number {
  return holidayDeductionBlocks(period, a, triggerCount).length;
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

// ------------------------------------------------------------ live dashboard

/** The state of one employee on one day, as shown on the dashboard. */
export type LiveState =
  | "present" // on time (within the cool-off)
  | "late" // punched in after the cool-off, before the half-day cut-off
  | "half_day" // half day (late past the cut-off, early leave beyond the limit, or a manual half day)
  | "absent" // no punch after the cool-off has passed, a day that has ended with no punch, or a punch marked absent
  | "on_leave" // approved leave
  | "off" // weekly off or company holiday (not counted)
  | "waiting" // today, shift started, not punched in yet and still inside the cool-off (not counted yet)
  | "not_started"; // future day, or before the employee joined (not counted)

export interface LiveInput {
  now: Date; // the real current instant
  tz: string; // company timezone
  workDate: Date; // UTC midnight of the local date being classified
  todayLocal: Date; // UTC midnight of today's local date
  shiftStart: string; // "HH:MM" for this employee
  graceMinutes: number;
  record?: { status: string; punchInTime: Date | null; punchOutTime: Date | null } | null;
  onLeave: boolean;
  offDay: boolean;
  joinDate?: Date | null; // UTC midnight of the joining date
}

/**
 * The state of an employee on `workDate`.
 * Punched days use the status recorded at punch time (already reflects late / half-day / late-percentage rules),
 * with a missing punch-out on a past day becoming a half day. Days with no punch are absent once the cool-off has
 * passed (today) or once the day is over, unless they are on approved leave or off.
 */
export function liveDayState(i: LiveInput): LiveState {
  if (i.joinDate && i.workDate.getTime() < i.joinDate.getTime()) return "not_started";
  if (i.workDate.getTime() > i.todayLocal.getTime()) return "not_started";

  if (i.record?.punchInTime) {
    return effectiveStatus(
      { status: i.record.status, hasPunchIn: true, hasPunchOut: !!i.record.punchOutTime },
      i.workDate,
      i.todayLocal
    ) as LiveState;
  }
  // A half day entered directly on the attendance page (no punches) stays a half day.
  if (i.record?.status === "half_day") return "half_day";
  if (i.onLeave) return "on_leave";
  if (i.offDay) return "off";

  if (i.workDate.getTime() < i.todayLocal.getTime()) return "absent"; // the day has ended with no punch

  // Today, not punched in yet.
  const minutes = localParts(i.now, i.tz).minutes;
  const start = parseHHMM(i.shiftStart);
  if (minutes <= start + i.graceMinutes) return "waiting";
  return "absent";
}

/** States that count toward range totals. Off, waiting and not-started days are not counted. */
export const COUNTED_STATES: LiveState[] = ["present", "late", "half_day", "absent", "on_leave"];

export interface RangeCounts {
  present: number; // on time
  late: number;
  halfDay: number;
  absent: number;
  onLeave: number;
}

export function emptyCounts(): RangeCounts {
  return { present: 0, late: 0, halfDay: 0, absent: 0, onLeave: 0 };
}

/** Adds one classified day to a running total. */
export function addState(counts: RangeCounts, state: LiveState): void {
  switch (state) {
    case "present":
      counts.present += 1;
      break;
    case "late":
      counts.late += 1;
      break;
    case "half_day":
      counts.halfDay += 1;
      break;
    case "absent":
      counts.absent += 1;
      break;
    case "on_leave":
      counts.onLeave += 1;
      break;
    default:
      break;
  }
}

/** Sort order for the live roster: what needs the admin's attention first. */
export const STATE_ORDER: Record<LiveState, number> = {
  absent: 0,
  late: 1,
  half_day: 2,
  waiting: 3,
  present: 4,
  on_leave: 5,
  off: 6,
  not_started: 7,
};
