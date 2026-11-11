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
  buildDeductionLedger,
  computeSalary,
  cyclePeriod,
  DEFAULT_SALARY_DISBURSEMENT_DAY,
  dateKey,
  holdDelayDaysOf,
  holidayDeductionBlocks,
  localParts,
  localWorkDate,
  salaryDateOf,
  SALARY_BASE_DAYS,
  shiftHours,
  summarizeMonth,
  type AbsenceContext,
  type DayRecord,
  type LedgerEntry,
  type MonthSummary,
  type Period,
  type SalaryResult,
} from "@/lib/payroll";

/**
 * Days loaded before and after a pay period. The Sunday / holiday rule looks at the working day just outside a
 * block of off-days, which can fall in the neighbouring cycle, so records are loaded this far beyond the period.
 */
export const HOLIDAY_CONTEXT_DAYS = 7;

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
    unapprovedDays: number; // unapproved days in this run
    days: number; // disbursement delay this run adds: unapproved days x delay per day
    amount: number; // money held under the earlier rule (0 for every new calculation)
    status: "active" | "released";
    id?: string;
  }[];
  record: SalaryRecord | null; // persisted row, if any
  frozen: boolean; // finalized / paid: figures come from the stored record
  salaryDate: Date; // the day the salary is due: the chosen day of the month after the cycle ends
  disbursementDate: Date; // when it is paid: the salary date plus the hold delay
  ledger: LedgerEntry[] | null; // day-wise deduction log; null = finalized before the log was recorded
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
  const tz = settings.timezone || "UTC";

  const storedHoldByDay = new Map(input.storedHolds.map((h) => [dateKey(h.occurrenceDate), h]));
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
      punchInMinutes: r.punchInTime ? localParts(r.punchInTime, tz).minutes : null,
      punchOutMinutes: r.punchOutTime ? localParts(r.punchOutTime, tz).minutes : null,
    });
  }

  const weeklyOff = weeklyOffOf(settings);
  const todayLocal = localWorkDate(now, tz);
  const joinDate = localWorkDate(emp.hireDate, tz);
  const approvedLeaves = input.leaves.map((l) => ({ start: l.startDate, end: l.endDate }));

  const summary = summarizeMonth({
    year,
    month,
    period,
    rules: summaryRulesOf(settings),
    weeklyOff,
    holidays,
    records,
    approvedLeaves,
    todayLocal,
    joinDate,
  });

  // ---- Salary hold: every unapproved day delays the disbursement date. Released runs do not delay.
  const holdsEnabled = !!settings.salaryHoldEnabled;
  const delayPerDay = Math.max(0, settings.unapprovedHoldDays ?? 2);
  const runs = summary.unapprovedOccurrences.map((d, idx) => {
    const stored = storedHoldByDay.get(dateKey(d));
    return {
      occurrenceDate: d,
      unapprovedDays: summary.unapprovedRunLengths[idx] ?? 1,
      released: stored?.status === "released",
      stored,
    };
  });
  const activeDelayDays = holdDelayDaysOf(
    runs.map((r) => ({ unapprovedDays: r.unapprovedDays, released: r.released })),
    delayPerDay,
    holdsEnabled
  );
  // A finalized month lists the runs it stored; a draft lists every run while the rule is on.
  const holds = (frozen ? runs.filter((r) => r.stored) : holdsEnabled ? runs : []).map((r) => {
    const legacyAmount = Number(r.stored?.amount ?? 0); // money held under the earlier rule
    const delay =
      frozen && r.stored
        ? legacyAmount > 0 ? 0 : r.stored.days
        : holdsEnabled ? r.unapprovedDays * delayPerDay : 0;
    return {
      occurrenceDate: r.occurrenceDate,
      unapprovedDays: r.unapprovedDays,
      days: delay,
      amount: frozen ? legacyAmount : 0,
      status: (r.released ? "released" : "active") as "active" | "released",
      id: r.stored?.id,
    };
  });

  // ---- Dates. A finalized salary keeps the dates it was calculated with.
  const legacyHold = frozen && !!record && Number(record.salaryHoldAmount) > 0; // finalized under the money-hold rule
  const salaryDate = frozen
    ? record?.salaryDate ?? addDays(period.end, settings.salaryPayDelayDays ?? 0)
    : salaryDateOf(year, month, settings.salaryDisbursementDay ?? DEFAULT_SALARY_DISBURSEMENT_DAY);
  const delayDays = frozen && record ? (legacyHold ? 0 : record.salaryHoldDays) : activeDelayDays;
  const disbursementDate = frozen ? record?.disbursementDate ?? salaryDate : addDays(salaryDate, delayDays);

  const basicSalary = record && record.status !== "draft" ? Number(record.basicSalary) : Number(emp.basicSalary);

  // Sunday / holiday pay cut (company rule). Finalized months keep the figure stored at finalization.
  const absence: AbsenceContext = {
    weeklyOff,
    holidays,
    records,
    approvedLeaves,
    todayLocal,
    joinDate,
    loadedStart: addDays(period.start, -HOLIDAY_CONTEXT_DAYS),
    loadedEnd: addDays(period.end, HOLIDAY_CONTEXT_DAYS),
  };
  const holidayBlocks =
    settings.holidayDeductionEnabled && !frozen
      ? holidayDeductionBlocks(period, absence, settings.holidayDeductionTriggerCount ?? 2)
      : [];

  // Standard month: the daily rate is always basic / 30, whatever the calendar length of the cycle.
  const shift = shiftOf(settings, emp);
  const lateRule = rule(settings.lateDeductionType, settings.lateDeductionValue);
  const halfDayRule = rule(settings.halfDayDeductionType, settings.halfDayDeductionValue);
  const leaveRule = rule(settings.leaveDeductionType, settings.leaveDeductionValue);
  const earlyLeaveRule = rule(settings.earlyLeaveDeductionType, settings.earlyLeaveDeductionValue);
  const lateMarks = { limit: settings.lateMarksLimit, penaltyDays: Number(settings.lateMarksPenaltyDays) };

  const result = computeSalary({
    basicSalary,
    workDaysPerMonth: SALARY_BASE_DAYS,
    summary,
    earlyLeaveRule,
    lateMarks,
    overtime: settings.overtimeEnabled ? { rate: Number(settings.overtimeRate) } : undefined,
    shiftHours: shiftHours(shift.start, shift.end),
    additions,
    lateRule,
    halfDayRule,
    leaveRule,
    holdDelayDays: activeDelayDays,
    otherDeductions,
    extraPay: { enabled: !!settings.extraPayEnabled, rate: Number(settings.extraPayRate) || 1 },
    holidayDeductionDays: holidayBlocks.length,
  });

  // The day-wise log: built live for an open cycle, and frozen with the salary when it is finalized.
  const ledger: LedgerEntry[] | null = frozen
    ? record?.deductionLedger ?? null
    : buildDeductionLedger({
        summary,
        dailyRate: basicSalary / SALARY_BASE_DAYS,
        lateRule,
        halfDayRule,
        leaveRule,
        earlyLeaveRule,
        lateMarks,
        compOffUsed: result.compOffUsed,
        holidayBlocks,
        otherDeductions,
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
      holdDays: delayDays,
      holdAmount: n(record.salaryHoldAmount),
      netBeforeHold: n(record.netPayable) + n(record.salaryHoldAmount),
      netPayable: n(record.netPayable),
      weekOffWorkedDays: record.weekOffWorkedDays,
      compOffUsed: record.compOffUsed,
      compOffUnused: record.compOffUnused,
      unpaidLeaveDays: Math.max(0, n(record.leaveDays) - record.compOffUsed),
      extraPayDays: record.extraPayDays,
      extraPay: n(record.extraPayAmount),
      holidayDeductionDays: record.holidayDeductionDays,
      holidayDeduction: n(record.holidayDeduction),
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
    salaryDate,
    disbursementDate,
    ledger,
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

  // Loaded a little wider than the period so the Sunday / holiday rule can see the days either side of it.
  const loadStart = addDays(start, -HOLIDAY_CONTEXT_DAYS);
  const loadEnd = addDays(end, HOLIDAY_CONTEXT_DAYS);
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
      .where(and(eq(attendance.employeeId, employeeId), gte(attendance.workDate, loadStart), lt(attendance.workDate, loadEnd))),
    db
      .select({ employeeId: leaveRequests.employeeId, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.employeeId, employeeId),
          eq(leaveRequests.status, "approved"),
          lt(leaveRequests.startDate, loadEnd),
          gte(leaveRequests.endDate, loadStart)
        )
      ),
    holidayKeys(companyId, loadStart, loadEnd),
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
  // Wider than the periods so the Sunday / holiday rule can see the days either side (see HOLIDAY_CONTEXT_DAYS).
  const rangeStart = addDays(new Date(minStart), -HOLIDAY_CONTEXT_DAYS);
  const rangeEnd = addDays(new Date(maxEnd), 1 + HOLIDAY_CONTEXT_DAYS); // exclusive

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
    holidayDeductionDays: result.holidayDeductionDays,
    holidayDeduction: result.holidayDeduction.toFixed(2),
    periodStart: c.period.start,
    periodEnd: c.period.end,
    salaryDate: c.salaryDate,
    disbursementDate: c.disbursementDate,
    deductionLedger: c.ledger ?? [],
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

  // Sync hold rows: keep existing ones (so releases stick), refresh the delay of active ones, add new runs,
  // and drop runs that have vanished or whose hold rule is now switched off.
  const existing = await db
    .select()
    .from(salaryHolds)
    .where(and(eq(salaryHolds.employeeId, employeeId), eq(salaryHolds.year, year), eq(salaryHolds.month, month)));
  const wanted = new Map(c.holds.map((h) => [dateKey(h.occurrenceDate), h]));
  const have = new Set<string>();
  for (const h of existing) {
    const key = dateKey(h.occurrenceDate);
    const want = wanted.get(key);
    if (!want) {
      await db.delete(salaryHolds).where(eq(salaryHolds.id, h.id));
      continue;
    }
    have.add(key);
    if (h.status === "active" && h.days !== want.days) {
      await db.update(salaryHolds).set({ days: want.days }).where(eq(salaryHolds.id, h.id));
    }
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
        amount: "0.00",
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

/**
 * Releasing a hold cancels that run's disbursement delay, so those days are paid on the salary date.
 * Holds from before the delay rule (which held money back) are paid out in money, as before.
 */
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

  // Re-derive the stored record so the delay, the disbursement date and the net stay consistent.
  const rec = await db
    .select()
    .from(salaryRecords)
    .where(and(eq(salaryRecords.employeeId, hold.employeeId), eq(salaryRecords.year, hold.year), eq(salaryRecords.month, hold.month)))
    .limit(1);
  const row = rec[0];
  if (row) {
    const legacyAmount = Number(hold.amount);
    if (legacyAmount > 0) {
      await db
        .update(salaryRecords)
        .set({
          salaryHoldAmount: Math.max(0, Number(row.salaryHoldAmount) - legacyAmount).toFixed(2),
          netPayable: (Number(row.netPayable) + legacyAmount).toFixed(2),
          updatedAt: new Date(),
        })
        .where(eq(salaryRecords.id, row.id));
    } else {
      const delay = Math.max(0, row.salaryHoldDays - hold.days);
      await db
        .update(salaryRecords)
        .set({
          salaryHoldDays: delay,
          disbursementDate: row.salaryDate ? addDays(row.salaryDate, delay) : row.disbursementDate,
          updatedAt: new Date(),
        })
        .where(eq(salaryRecords.id, row.id));
    }
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
