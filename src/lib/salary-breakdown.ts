import type { SalaryComputation } from "@/lib/salary";

/**
 * The payslip figures for one employee and cycle. Shared by the salary page and salary slip downloads,
 * so the two can never show different numbers.
 */
export function breakdownOf(c: SalaryComputation) {
  const r = c.result;
  const s = c.summary;
  return {
    basicSalary: c.basicSalary,
    dailyRate: r.dailyRate,
    presentDays: s.presentDays,
    absentDays: s.absentDays,
    lateDays: s.lateDays,
    halfDays: s.halfDays,
    leaveDays: s.leaveDays,
    unapprovedLeaveCount: s.unapprovedOccurrences.length,
    attendanceSalary: r.attendanceSalary,
    // per-late deduction plus the "every N late marks" penalty
    lateDeduction: Math.round((r.lateDeduction + r.lateMarksDeduction) * 100) / 100,
    earlyLeaveDays: s.earlyLeaveDays ?? 0,
    earlyLeaveDeduction: r.earlyLeaveDeduction,
    overtimeMinutes: s.overtimeMinutes ?? 0,
    overtimePay: r.overtimePay,
    weekOffWorkedDays: r.weekOffWorkedDays,
    compOffUsed: r.compOffUsed,
    compOffUnused: r.compOffUnused,
    unpaidLeaveDays: r.unpaidLeaveDays,
    extraPayDays: r.extraPayDays,
    extraPay: r.extraPay,
    additions: c.additions,
    additionsTotal: r.additionsTotal,
    halfDayDeduction: r.halfDayDeduction,
    leaveDeduction: r.leaveDeduction,
    holidayDeductionDays: r.holidayDeductionDays,
    holidayDeduction: r.holidayDeduction,
    otherDeductions: c.otherDeductions,
    // permanent deductions only. The salary hold is a delay of the disbursement date, not a deduction.
    totalDeductions: r.totalDeductions,
    // salary-hold delay in days (the disbursement date moves by this many days)
    salaryHoldDays: r.holdDays,
    // money held under the earlier rule (0 for every new calculation; kept so finalized history reads correctly)
    salaryHoldAmount: r.holdAmount,
    netBeforeHold: r.netBeforeHold,
    netPayable: r.netPayable,
    // day-wise deduction log (null = not recorded for this finalized salary)
    ledger: c.ledger,
  };
}

export type SalaryBreakdown = ReturnType<typeof breakdownOf>;
