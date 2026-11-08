import type { CompanySettings } from "@/db/schema";
import { addDays, currentCycleKey, cyclePeriod, dateKey, localWorkDate, type Period } from "@/lib/payroll";
import type { SalaryComputation } from "@/lib/salary";

/** A day-count at or above this in one cycle is flagged as excessive leave. */
export const EXCESSIVE_LEAVE_DAYS = 3;

export interface ReportRange {
  year: number;
  month: number;
  customPeriod?: Period;
  label: string; // human readable, used in headings and file names
  key: string; // "2026-11" for a salary cycle, "custom-2026-10-01-2026-10-31" for a date range
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses ?month=YYYY-MM (a salary cycle) or ?from=&to= (any date range). Defaults to the current cycle. */
export function parseReportRange(
  params: URLSearchParams,
  settings: CompanySettings,
  now: Date
): { range?: ReportRange; error?: string } {
  const from = params.get("from");
  const to = params.get("to");
  if (from || to) {
    if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) return { error: "Choose a valid start and end date." };
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    if (end < start) return { error: "The end date is before the start date." };
    if ((end.getTime() - start.getTime()) / 86400000 > 366) return { error: "Choose a range of up to one year." };
    return {
      range: {
        year: start.getUTCFullYear(),
        month: start.getUTCMonth() + 1,
        customPeriod: { start, end },
        label: `${from} to ${to}`,
        key: `custom-${from}-${to}`,
      },
    };
  }

  const month = params.get("month");
  const today = localWorkDate(now, settings.timezone || "UTC");
  const cycle =
    month && MONTH_RE.test(month)
      ? { year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) }
      : currentCycleKey(today, settings.salaryCycleStartDay);
  const p = cyclePeriod(cycle.year, cycle.month, settings.salaryCycleStartDay);
  const key = `${cycle.year}-${String(cycle.month).padStart(2, "0")}`;
  return {
    range: {
      year: cycle.year,
      month: cycle.month,
      label: `${dateKey(p.start)} to ${dateKey(p.end)}`,
      key,
    },
  };
}

export interface OverviewRow {
  employeeId: string;
  name: string;
  code: string | null;
  designation: string | null;
  departments: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  status: string; // preview | draft | finalized | paid
  gross: number; // basic salary
  deductions: number; // everything taken off: absent days + late + half days + leave + early leave + other
  credits: number; // additions + overtime + extra pay
  holds: number; // temporarily held (releasable)
  net: number; // net payable balance for this employee
  lateDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  unpaidLeaveDays: number;
  earlyLeaveDays: number;
  overtimeMinutes: number;
  lateDeduction: number;
  halfDayDeduction: number;
  leaveDeduction: number;
  earlyLeaveDeduction: number;
  otherDeductions: number;
  absentDeduction: number;
  additions: number;
  overtimePay: number;
  extraPay: number;
  flags: { excessiveLeave: boolean; lateMarks: boolean };
}

export interface OrgInfo {
  name: string;
  code: string | null;
  departments: { id: string; name: string }[];
  locations: { id: string; name: string }[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function toOverviewRow(c: SalaryComputation, org: OrgInfo, lateLimit: number): OverviewRow {
  const r = c.result;
  const s = c.summary;
  const absentDeduction = Math.max(0, c.basicSalary - r.attendanceSalary);
  const deductions = absentDeduction + r.totalDeductions;
  const credits = r.additionsTotal + r.overtimePay + r.extraPay;
  const lateThreshold = lateLimit > 0 ? lateLimit : 3;
  return {
    employeeId: c.employee.id,
    name: org.name,
    code: org.code,
    designation: c.employee.designation ?? null,
    departments: org.departments,
    locations: org.locations,
    status: c.record?.status ?? "preview",
    gross: round2(c.basicSalary),
    deductions: round2(deductions),
    credits: round2(credits),
    holds: round2(r.holdAmount),
    net: round2(r.netPayable),
    lateDays: s.lateDays,
    halfDays: s.halfDays,
    absentDays: round2(s.absentDays),
    leaveDays: round2(s.leaveDays),
    unpaidLeaveDays: round2(r.unpaidLeaveDays),
    earlyLeaveDays: s.earlyLeaveDays ?? 0,
    overtimeMinutes: s.overtimeMinutes ?? 0,
    lateDeduction: round2(r.lateDeduction + r.lateMarksDeduction),
    halfDayDeduction: round2(r.halfDayDeduction),
    leaveDeduction: round2(r.leaveDeduction),
    earlyLeaveDeduction: round2(r.earlyLeaveDeduction),
    otherDeductions: round2(r.otherTotal),
    absentDeduction: round2(absentDeduction),
    additions: round2(r.additionsTotal),
    overtimePay: round2(r.overtimePay),
    extraPay: round2(r.extraPay),
    flags: {
      excessiveLeave: s.leaveDays >= EXCESSIVE_LEAVE_DAYS,
      lateMarks: s.lateDays >= lateThreshold,
    },
  };
}

export interface OverviewTotals {
  employees: number;
  gross: number;
  deductions: number;
  credits: number;
  holds: number;
  net: number;
  lateDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  flagged: number;
  notCalculated: number;
  statusCounts: { preview: number; draft: number; finalized: number; paid: number };
}

export function totalsOf(rows: OverviewRow[]): OverviewTotals {
  const sum = (f: (r: OverviewRow) => number) => round2(rows.reduce((t, r) => t + f(r), 0));
  const statusCounts = { preview: 0, draft: 0, finalized: 0, paid: 0 };
  for (const r of rows) {
    if (r.status in statusCounts) statusCounts[r.status as keyof typeof statusCounts] += 1;
  }
  return {
    employees: rows.length,
    gross: sum((r) => r.gross),
    deductions: sum((r) => r.deductions),
    credits: sum((r) => r.credits),
    holds: sum((r) => r.holds),
    net: sum((r) => r.net),
    lateDays: rows.reduce((t, r) => t + r.lateDays, 0),
    halfDays: rows.reduce((t, r) => t + r.halfDays, 0),
    absentDays: round2(rows.reduce((t, r) => t + r.absentDays, 0)),
    leaveDays: round2(rows.reduce((t, r) => t + r.leaveDays, 0)),
    flagged: rows.filter((r) => r.flags.excessiveLeave || r.flags.lateMarks).length,
    notCalculated: 0,
    statusCounts,
  };
}

/** Days in the cycle (inclusive), for display. */
export function periodDays(p: Period): number {
  return Math.round((p.end.getTime() - p.start.getTime()) / 86400000) + 1;
}

export { addDays };
