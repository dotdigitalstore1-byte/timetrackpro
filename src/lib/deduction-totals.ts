/**
 * One place for the deduction totals. The salary page summary, the day-wise deduction log and the payslip all
 * read these, so they can never disagree.
 *
 * Why a separate total: an unapproved absence reduces the attendance-based salary (basic minus absent days),
 * so it is not part of `totalDeductions` (the permanent deductions). The log still lists it, so the summary
 * has to add it back in or the two drift apart.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Money taken for unapproved absences: basic salary minus the attendance-based salary (never negative). */
export function unapprovedAbsenceDeduction(basicSalary: number, attendanceSalary: number): number {
  return round2(Math.max(0, basicSalary - attendanceSalary));
}

/** Every amount taken off the salary: unapproved absences plus the permanent deductions. */
export function allDeductionsTotal(absenceDeduction: number, totalDeductions: number): number {
  return round2(absenceDeduction + totalDeductions);
}

/** The sum of the day-wise log. Zero-amount lines (comp-off covered, excused) add nothing. */
export function ledgerTotal(ledger: { amount: number }[]): number {
  return round2(ledger.reduce((t, l) => t + l.amount, 0));
}
