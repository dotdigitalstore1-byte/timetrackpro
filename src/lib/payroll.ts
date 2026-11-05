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

export function monthWorkdays(
  year: number,
  month: number,
  weeklyOff: Set<number>,
  holidays: Set<string> = new Set()
): Date[] {
  const out: Date[] = [];
  const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let i = 1; i <= total; i++) {
    const d = new Date(Date.UTC(year, month - 1, i));
    if (weeklyOff.has(d.getUTCDay())) continue;
    if (holidays.has(dateKey(d))) continue;
    out.push(d);
  }
  return out;
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
}

export interface MonthSummary {
  presentDays: number; // full-day attendances (incl. late)
  lateDays: number;
  halfDays: number;
  leaveDays: number; // approved leave on workdays
  absentDays: number; // workdays with no punch and no approved leave
  unapprovedOccurrences: Date[]; // first day of each consecutive absent block
}

/**
 * Walks every workday of the month up to (but not including) `todayLocal`.
 * A workday with no punch-in and no approved leave is "unapproved leave".
 * Consecutive unapproved workdays form ONE occurrence (one hold).
 */
export function summarizeMonth(args: {
  year: number;
  month: number;
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
  };
  let inBlock = false;

  for (const day of monthWorkdays(args.year, args.month, args.weeklyOff, args.holidays)) {
    if (args.joinDate && day.getTime() < args.joinDate.getTime()) continue;
    const rec = args.records.get(dateKey(day));
    if (rec?.hasPunchIn) {
      inBlock = false;
      if (rec.status === "half_day") out.halfDays += 1;
      else {
        out.presentDays += 1;
        if (rec.status === "late") out.lateDays += 1;
      }
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
  return out;
}

// ------------------------------------------------------------------- salary

export interface DeductionRule {
  type: "percentage" | "fixed";
  value: number;
}

export interface SalaryInput {
  basicSalary: number;
  workDaysPerMonth: number; // divisor for the daily rate
  summary: MonthSummary;
  lateRule: DeductionRule; // per late day
  halfDayRule: DeductionRule; // per half day
  leaveRule: DeductionRule; // per approved leave day
  holdDaysPerOccurrence: number;
  releasedHoldCount: number; // occurrences whose hold has been released
  otherDeductions: { label: string; amount: number }[];
}

export interface SalaryResult {
  dailyRate: number;
  attendanceSalary: number; // basic minus unpaid (unapproved absent) days
  lateDeduction: number;
  halfDayDeduction: number;
  leaveDeduction: number;
  otherTotal: number;
  totalDeductions: number; // permanent deductions only (holds are separate)
  holdDays: number; // ACTIVE hold days
  holdAmount: number; // ACTIVE hold amount (temporary, releasable)
  netBeforeHold: number;
  netPayable: number; // payable now = net before hold - active holds
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function perUnit(rule: DeductionRule, dailyRate: number): number {
  return rule.type === "fixed" ? rule.value : (dailyRate * rule.value) / 100;
}

export function computeSalary(i: SalaryInput): SalaryResult {
  const dailyRate = i.workDaysPerMonth > 0 ? i.basicSalary / i.workDaysPerMonth : 0;
  const s = i.summary;

  const attendanceSalary = Math.max(0, i.basicSalary - s.absentDays * dailyRate);
  const lateDeduction = s.lateDays * perUnit(i.lateRule, dailyRate);
  const halfDayDeduction = s.halfDays * perUnit(i.halfDayRule, dailyRate);
  const leaveDeduction = s.leaveDays * perUnit(i.leaveRule, dailyRate);
  const otherTotal = i.otherDeductions.reduce((t, d) => t + Number(d.amount || 0), 0);
  const totalDeductions = lateDeduction + halfDayDeduction + leaveDeduction + otherTotal;

  const activeOccurrences = Math.max(0, s.unapprovedOccurrences.length - i.releasedHoldCount);
  const holdDays = activeOccurrences * i.holdDaysPerOccurrence;
  const holdAmount = holdDays * dailyRate;

  const netBeforeHold = Math.max(0, attendanceSalary - totalDeductions);
  const netPayable = Math.max(0, netBeforeHold - holdAmount);

  return {
    dailyRate: r2(dailyRate),
    attendanceSalary: r2(attendanceSalary),
    lateDeduction: r2(lateDeduction),
    halfDayDeduction: r2(halfDayDeduction),
    leaveDeduction: r2(leaveDeduction),
    otherTotal: r2(otherTotal),
    totalDeductions: r2(totalDeductions),
    holdDays,
    holdAmount: r2(holdAmount),
    netBeforeHold: r2(netBeforeHold),
    netPayable: r2(netPayable),
  };
}
