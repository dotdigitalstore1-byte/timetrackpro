import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  attendance,
  auditLogs,
  companySettings,
  employees,
  leaveRequests,
  salaryHolds,
  salaryRecords,
  users,
} from "@/db/schema";
import type { CompanySettings, Employee, SalaryHold, SalaryRecord } from "@/db/schema";
import { holidayKeys, shiftOf, summaryRulesOf, weeklyOffOf } from "@/lib/company";
import {
  addDays,
  computeSalary,
  cyclePeriod,
  dateKey,
  localWorkDate,
  SALARY_BASE_DAYS,
  shiftHours,
  summarizeMonth,
  type DayRecord,
  type MonthSummary,
  type Period,
  type SalaryResult,
} from "@/lib/payroll";

export interface SalaryComputation {
  employee: Employee;
  year: number;
  month: number;
  employeeId: string;
  basicSalary: number;
  summary: MonthSummary;
  result: SalaryResult;
  otherDeductions: { label: string; amount: number }[];
  additions: { label: string; amount: number }[];
  period: Period; // the pay period this cycle covers (inclusive)
  holds: {
    occurrenceDate: Date;
    days: number;
    amount: number;
    status: "active" | "released";
    id?: string;
  }[];
  record: SalaryRecord | null; // persisted row, if any
  frozen: boolean; // finalized / paid: figures come from the stored record
}

function rule(type: string, value: string | number) {
  return { type: (type === "fixed" ? "fixed" : "percentage") as "fixed" | "percentage", value: Number(value) };
}

async function loadSettings(companyId: string): Promise<CompanySettings> {
  const rows = await db.select().from(companySettings).where(eq(companySettings.companyId, companyId)).limit(1);
  if (!rows[0]) throw new Error("Company settings not configured");
  return rows[0];
}

type AttendanceRow = {
  employeeId: string;
  workDate: Date;
  status: string;
  punchInTime: Date | null;
  punchOutTime: Date | null;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
};
type LeaveRow = { employeeId: string; startDate: Date; endDate: Date };

/** Everything needed to work out one employee's month, already loaded from the database. */
export interface MonthInput {
  employee: Employee;
  record: SalaryRecord | null; // stored record for this month (any status)
  customPeriod?: Period; // an explicit date range instead of the salary cycle (ignores stored records)
  storedHolds: SalaryHold[];
  att: AttendanceRow[];
  leaves: { startDate: Date; endDate: Date }[];
}

/**
 * The pay period for a month. Finalized / paid records keep the period they were calculated for, even if the
 * cycle setting changes later. Records finalized before salary cycles existed were calendar months.
 */
export function resolvePeriod(
  settings: CompanySettings,
  year: number,
  month: number,
  record: SalaryRecord | null,
  customPeriod?: Period
): { period: Period; frozen: boolean } {
  if (customPeriod) return { period: customPeriod, frozen: false };
  const isFrozen = !!record && record.status !== "draft";
  const period: Period =
    isFrozen && record?.periodStart && record.periodEnd
      ? { start: record.periodStart, end: record.periodEnd }
      : isFrozen
        ? cyclePeriod(year, month, 1)
        : cyclePeriod(year, month, settings.salaryCycleStartDay);
  return { period, frozen: isFrozen };
}

/** PURE: works out one employee's month from already-loaded data. Never reads or writes the database. */
export function computeFromData(
  settings: CompanySettings,
  holidays: Set<string>,
  year: number,
  month: number,
  input: MonthInput,
  now: Date = new Date()
): SalaryComputation {
  const emp = input.employee;
  const record = input.customPeriod ? null : input.record;
  const { period, frozen } = resolvePeriod(settings, year, month, record, input.customPeriod);

  const holdByDay = new Map(input.storedHolds.map((h) => [dateKey(h.occurrenceDate), h]));
  const otherDeductions = (record?.otherDeductions ?? []) as { label: string; amount: number }[];
  const additions = (record?.additions ?? []) as { label: string; amount: number }[];

  const records = new Map<string, DayRecord>();
  for (const r of input.att) {
    records.set(dateKey(r.workDate), {
      status: r.status,
      hasPunchIn: !!r.punchInTime,
      hasPunchOut: !!r.punchOutTime,
      earlyLeaveMinutes: r.earlyLeaveMinutes,
      overtimeMinutes: r.overtimeMinutes,
    });
  }

  const summary = summarizeMonth({
    year,
    month,
    period,
    rules: summaryRulesOf(settings),
    weeklyOff: weeklyOffOf(settings),
    holidays,
    records,
    approvedLeaves: input.leaves.map((l) => ({ start: l.startDate, end: l.endDate })),
    todayLocal: localWorkDate(now, settings.timezone),
    joinDate: localWorkDate(emp.hireDate, settings.timezone),
  });

  const releasedCount = summary.unapprovedOccurrences.filter(
    (d) => holdByDay.get(dateKey(d))?.status === "released"
  ).length;

  const holdDaysEach = settings.unapprovedHoldDays ?? 2;
  const basicSalary = record && record.status !== "draft" ? Number(record.basicSalary) : Number(emp.basicSalary);

  // Standard month: the daily rate is always basic / 30, whatever the calendar length of the cycle.
  const shift = shiftOf(settings, emp);

  const result = computeSalary({
    basicSalary,
    workDaysPerMonth: SALARY_BASE_DAYS,
    summary,
    earlyLeaveRule: rule(settings.earlyLeaveDeductionType, settings.earlyLeaveDeductionValue),
    lateMarks: { limit: settings.lateMarksLimit, penaltyDays: Number(settings.lateMarksPenaltyDays) },
    overtime: settings.overtimeEnabled ? { rate: Number(settings.overtimeRate) } : undefined,
    shiftHours: shiftHours(shift.start, shift.end),
    additions,
    lateRule: rule(settings.lateDeductionType, settings.lateDeductionValue),
    halfDayRule: rule(settings.halfDayDeductionType, settings.halfDayDeductionValue),
    leaveRule: rule(settings.leaveDeductionType, settings.leaveDeductionValue),
    holdDaysPerOccurrence: holdDaysEach,
    releasedHoldCount: releasedCount,
    otherDeductions,
    extraPay: { enabled: !!settings.extraPayEnabled, rate: Number(settings.extraPayRate) || 1 },
  });

  // Finalized / paid months are frozen: show exactly what was stored at finalization.
  let finalResult: SalaryResult = result;
  let finalSummary: MonthSummary = summary;
  if (frozen && record) {
    const n = (v: string | number) => Number(v);
    finalResult = {
      dailyRate: n(record.dailyRate),
      attendanceSalary: n(record.attendanceSalary),
      lateDeduction: n(record.lateDeduction), // stored value already includes the late-marks penalty
      lateMarksDeduction: 0,
      earlyLeaveDeduction: n(record.earlyLeaveDeduction),
      halfDayDeduction: n(record.halfDayDeduction),
      leaveDeduction: n(record.leaveDeduction),
      otherTotal: otherDeductions.reduce((t, d) => t + Number(d.amount || 0), 0),
      overtimePay: n(record.overtimePay),
      additionsTotal: additions.reduce((t, a) => t + Number(a.amount || 0), 0),
      totalDeductions: n(record.totalDeductions),
      holdDays: record.salaryHoldDays,
      holdAmount: n(record.salaryHoldAmount),
      netBeforeHold: n(record.netPayable) + n(record.salaryHoldAmount),
      netPayable: n(record.netPayable),
      weekOffWorkedDays: record.weekOffWorkedDays,
      compOffUsed: record.compOffUsed,
      compOffUnused: record.compOffUnused,
      unpaidLeaveDays: Math.max(0, n(record.leaveDays) - record.compOffUsed),
      extraPayDays: record.extraPayDays,
      extraPay: n(record.extraPayAmount),
    };
    finalSummary = {
      ...summary,
      presentDays: n(record.presentDays),
      absentDays: n(record.absentDays),
      lateDays: record.lateDays,
      halfDays: record.halfDays,
      leaveDays: n(record.leaveDays),
      earlyLeaveDays: record.earlyLeaveDays,
      overtimeMinutes: record.overtimeMinutes,
    };
  }

  const holds = summary.unapprovedOccurrences.map((d) => {
    const stored = holdByDay.get(dateKey(d));
    return {
      occurrenceDate: d,
      days: holdDaysEach,
      amount: Math.round(holdDaysEach * finalResult.dailyRate * 100) / 100,
      status: (stored?.status === "released" ? "released" : "active") as "active" | "released",
      id: stored?.id,
    };
  });

  return {
    employee: emp,
    year,
    month,
    employeeId: emp.id,
    basicSalary,
    summary: finalSummary,
    result: finalResult,
    otherDeductions,
    additions,
    period,
    holds,
    record,
    frozen,
  };
}

/** READ-ONLY: computes one employee's month. Finalized/paid months return the stored, frozen figures. */
export async function computeMonth(
  companyId: string,
  employeeId: string,
  year: number,
  month: number
): Promise<SalaryComputation> {
  const empRows = await db
    .select()
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.companyId, companyId)))
    .limit(1);
  const emp = empRows[0];
  if (!emp) throw new Error("Employee not found");

  const settings = await loadSettings(companyId);
  const existingRows = await db
    .select()
    .from(salaryRecords)
    .where(and(eq(salaryRecords.employeeId, employeeId), eq(salaryRecords.year, year), eq(salaryRecords.month, month)))
    .limit(1);
  const record = existingRows[0] ?? null;
  const { period } = resolvePeriod(settings, year, month, record);
  const start = period.start;
  const end = addDays(period.end, 1); // exclusive

  const [storedHolds, att, leaves, holidays] = await Promise.all([
    db.select().from(salaryHolds).where(and(eq(salaryHolds.employeeId, employeeId), eq(salaryHolds.year, year), eq(salaryHolds.month, month))),
    // Only the fields payroll uses: never load punch photos to calculate pay.
    db
      .select({
        employeeId: attendance.employeeId,
        workDate: attendance.workDate,
        status: attendance.status,
        punchInTime: attendance.punchInTime,
        punchOutTime: attendance.punchOutTime,
        earlyLeaveMinutes: attendance.earlyLeaveMinutes,
        overtimeMinutes: attendance.overtimeMinutes,
      })
      .from(attendance)
      .where(and(eq(attendance.employeeId, employeeId), gte(attendance.workDate, start), lt(attendance.workDate, end))),
    db
      .select({ employeeId: leaveRequests.employeeId, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.employeeId, employeeId),
          eq(leaveRequests.status, "approved"),
          lt(leaveRequests.startDate, end),
          gte(leaveRequests.endDate, start)
        )
      ),
    holidayKeys(companyId, start, end),
  ]);

  return computeFromData(settings, holidays, year, month, {
    employee: emp,
    record,
    storedHolds,
    att,
    leaves,
  });
}

/**
 * READ-ONLY, BULK: works out every employee's month with one query per table (not one per employee).
 * Used for the company overview and exports. Pass `customPeriod` for an arbitrary date range.
 */
export async function computeAllForMonth(
  companyId: string,
  year: number,
  month: number,
  opts: { customPeriod?: Period; employeeIds?: string[] } = {}
): Promise<SalaryComputation[]> {
  if (opts.employeeIds && opts.employeeIds.length === 0) return [];
  const settings = await loadSettings(companyId);
  const empRows = await db
    .select({ employee: employees })
    .from(employees)
    .innerJoin(users, eq(employees.userId, users.id))
    .where(
      and(
        eq(employees.companyId, companyId),
        eq(users.role, "employee"),
        opts.employeeIds ? inArray(employees.id, opts.employeeIds) : undefined
      )
    );
  const emps = empRows.map((r) => r.employee);
  if (emps.length === 0) return [];
  const ids = emps.map((e) => e.id);

  const [recordRows, holdRows] = await Promise.all([
    db
      .select()
      .from(salaryRecords)
      .where(and(eq(salaryRecords.companyId, companyId), eq(salaryRecords.year, year), eq(salaryRecords.month, month), inArray(salaryRecords.employeeId, ids))),
    db
      .select()
      .from(salaryHolds)
      .where(and(eq(salaryHolds.year, year), eq(salaryHolds.month, month), inArray(salaryHolds.employeeId, ids))),
  ]);
  const recordByEmp = new Map(recordRows.map((r) => [r.employeeId, r]));
  const holdsByEmp = new Map<string, SalaryHold[]>();
  for (const h of holdRows) holdsByEmp.set(h.employeeId, [...(holdsByEmp.get(h.employeeId) ?? []), h]);

  const periodByEmp = new Map<string, Period>(
    emps.map((e): [string, Period] => [e.id, resolvePeriod(settings, year, month, recordByEmp.get(e.id) ?? null, opts.customPeriod).period])
  );
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const p of periodByEmp.values()) {
    minStart = Math.min(minStart, p.start.getTime());
    maxEnd = Math.max(maxEnd, p.end.getTime());
  }
  const rangeStart = new Date(minStart);
  const rangeEnd = addDays(new Date(maxEnd), 1); // exclusive

  const [attRows, leaveRows, holidays] = await Promise.all([
    db
      .select({
        employeeId: attendance.employeeId,
        workDate: attendance.workDate,
        status: attendance.status,
        punchInTime: attendance.punchInTime,
        punchOutTime: attendance.punchOutTime,
        earlyLeaveMinutes: attendance.earlyLeaveMinutes,
        overtimeMinutes: attendance.overtimeMinutes,
      })
      .from(attendance)
      .where(and(eq(attendance.companyId, companyId), inArray(attendance.employeeId, ids), gte(attendance.workDate, rangeStart), lt(attendance.workDate, rangeEnd))),
    db
      .select({ employeeId: leaveRequests.employeeId, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.companyId, companyId),
          eq(leaveRequests.status, "approved"),
          inArray(leaveRequests.employeeId, ids),
          lt(leaveRequests.startDate, rangeEnd),
          gte(leaveRequests.endDate, rangeStart)
        )
      ),
    holidayKeys(companyId, rangeStart, rangeEnd),
  ]);

  const attByEmp = new Map<string, AttendanceRow[]>();
  for (const r of attRows) attByEmp.set(r.employeeId, [...(attByEmp.get(r.employeeId) ?? []), r]);
  const leavesByEmp = new Map<string, LeaveRow[]>();
  for (const l of leaveRows) leavesByEmp.set(l.employeeId, [...(leavesByEmp.get(l.employeeId) ?? []), l]);

  const now = new Date();
  return emps.map((emp) =>
    computeFromData(
      settings,
      holidays,
      year,
      month,
      {
        employee: emp,
        record: recordByEmp.get(emp.id) ?? null,
        customPeriod: opts.customPeriod,
        storedHolds: opts.customPeriod ? [] : holdsByEmp.get(emp.id) ?? [],
        att: attByEmp.get(emp.id) ?? [],
        leaves: leavesByEmp.get(emp.id) ?? [],
      },
      now
    )
  );
}

/** Persists the computed month as a DRAFT (or refreshes an existing draft) and syncs hold rows. */
export async function saveDraft(companyId: string, employeeId: string, year: number, month: number): Promise<SalaryRecord> {
  const c = await computeMonth(companyId, employeeId, year, month);
  if (c.frozen) throw new Error("This month is already finalized. Payroll history cannot be recalculated.");

  const { result, summary } = c;
  const values = {
    basicSalary: c.basicSalary.toFixed(2),
    dailyRate: result.dailyRate.toFixed(2),
    presentDays: summary.presentDays.toFixed(1),
    absentDays: summary.absentDays.toFixed(1),
    lateDays: summary.lateDays,
    halfDays: summary.halfDays,
    leaveDays: summary.leaveDays.toFixed(1),
    unapprovedLeaveCount: summary.unapprovedOccurrences.length,
    attendanceSalary: result.attendanceSalary.toFixed(2),
    // the "every N late marks" penalty is stored together with the per-late deduction
    lateDeduction: (result.lateDeduction + result.lateMarksDeduction).toFixed(2),
    earlyLeaveDays: summary.earlyLeaveDays ?? 0,
    earlyLeaveDeduction: result.earlyLeaveDeduction.toFixed(2),
    overtimeMinutes: summary.overtimeMinutes ?? 0,
    overtimePay: result.overtimePay.toFixed(2),
    weekOffWorkedDays: result.weekOffWorkedDays,
    compOffUsed: result.compOffUsed,
    compOffUnused: result.compOffUnused,
    extraPayDays: result.extraPayDays,
    extraPayAmount: result.extraPay.toFixed(2),
    periodStart: c.period.start,
    periodEnd: c.period.end,
    halfDayDeduction: result.halfDayDeduction.toFixed(2),
    leaveDeduction: result.leaveDeduction.toFixed(2),
    otherDeductions: c.otherDeductions,
    additions: c.additions,
    salaryHoldDays: result.holdDays,
    salaryHoldAmount: result.holdAmount.toFixed(2),
    totalDeductions: result.totalDeductions.toFixed(2),
    netPayable: result.netPayable.toFixed(2),
    updatedAt: new Date(),
  };

  const rows = await db
    .insert(salaryRecords)
    .values({ companyId, employeeId, year, month, ...values })
    .onConflictDoUpdate({ target: [salaryRecords.employeeId, salaryRecords.year, salaryRecords.month], set: values })
    .returning();

  // Sync hold rows: keep existing (incl. released) ones, add new occurrences, drop vanished ones.
  const existing = await db
    .select()
    .from(salaryHolds)
    .where(and(eq(salaryHolds.employeeId, employeeId), eq(salaryHolds.year, year), eq(salaryHolds.month, month)));
  const wanted = new Map(c.holds.map((h) => [dateKey(h.occurrenceDate), h]));
  const have = new Set<string>();
  for (const h of existing) {
    const key = dateKey(h.occurrenceDate);
    if (!wanted.has(key)) await db.delete(salaryHolds).where(eq(salaryHolds.id, h.id));
    else have.add(key);
  }
  const toInsert = c.holds.filter((h) => !have.has(dateKey(h.occurrenceDate)));
  if (toInsert.length) {
    await db.insert(salaryHolds).values(
      toInsert.map((h) => ({
        companyId,
        employeeId,
        month,
        year,
        occurrenceDate: h.occurrenceDate,
        days: h.days,
        amount: h.amount.toFixed(2),
        reason: "Unapproved leave",
      }))
    );
  }
  return rows[0];
}

export async function finalizeMonth(companyId: string, employeeId: string, year: number, month: number, actorId: string) {
  const draft = await saveDraft(companyId, employeeId, year, month);
  const [row] = await db
    .update(salaryRecords)
    .set({ status: "finalized", finalizedAt: new Date(), finalizedBy: actorId, updatedAt: new Date() })
    .where(eq(salaryRecords.id, draft.id))
    .returning();
  await db.insert(auditLogs).values({
    companyId,
    actorId,
    action: "salary.finalize",
    entity: "salary",
    entityId: row.id,
    details: { employeeId, year, month, netPayable: row.netPayable },
  });
  return row;
}

/** Releasing a hold returns that amount to the employee (only while the month is still a draft or finalized-unpaid). */
export async function releaseHold(companyId: string, holdId: string, actorId: string) {
  const rows = await db
    .select()
    .from(salaryHolds)
    .where(and(eq(salaryHolds.id, holdId), eq(salaryHolds.companyId, companyId)))
    .limit(1);
  const hold = rows[0];
  if (!hold) throw new Error("Hold not found");
  if (hold.status === "released") throw new Error("This hold is already released");

  await db
    .update(salaryHolds)
    .set({ status: "released", releasedAt: new Date(), releasedBy: actorId })
    .where(eq(salaryHolds.id, holdId));

  // Re-derive the stored record so held/net figures stay consistent.
  const rec = await db
    .select()
    .from(salaryRecords)
    .where(and(eq(salaryRecords.employeeId, hold.employeeId), eq(salaryRecords.year, hold.year), eq(salaryRecords.month, hold.month)))
    .limit(1);
  if (rec[0]) {
    const releasedAmount = Number(hold.amount);
    const newHoldAmount = Math.max(0, Number(rec[0].salaryHoldAmount) - releasedAmount);
    const newHoldDays = Math.max(0, rec[0].salaryHoldDays - hold.days);
    const net = Number(rec[0].netPayable) + releasedAmount;
    await db
      .update(salaryRecords)
      .set({
        salaryHoldAmount: newHoldAmount.toFixed(2),
        salaryHoldDays: newHoldDays,
        netPayable: net.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(salaryRecords.id, rec[0].id));
  }
  await db.insert(auditLogs).values({
    companyId,
    actorId,
    action: "salary.hold_release",
    entity: "salary_hold",
    entityId: holdId,
    details: { employeeId: hold.employeeId, amount: hold.amount, days: hold.days },
  });
}

export type { SalaryHold };
