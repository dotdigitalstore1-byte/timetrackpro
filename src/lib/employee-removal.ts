import { eq } from "drizzle-orm";
import type { db as Db } from "@/db";
import {
  attendanceAudit,
  auditLogs,
  companyAgreements,
  employees,
  leaveRequests,
  noticePeriods,
  salaryHolds,
  salaryRecords,
  salarySlipRequests,
  users,
} from "@/db/schema";

type Tx = Parameters<Parameters<typeof Db.transaction>[0]>[0];

/**
 * Deletes an employee's login account. Rows that merely reference the person as the approver or author are kept with the
 * reference cleared; the person's own employee, attendance, leave and salary rows cascade away with the account.
 */
export async function removeEmployeeUser(tx: Tx, userId: string, employeeId: string): Promise<void> {
  await tx.update(leaveRequests).set({ approvedBy: null }).where(eq(leaveRequests.approvedBy, userId));
  await tx.update(leaveRequests).set({ rejectedBy: null }).where(eq(leaveRequests.rejectedBy, userId));
  await tx.update(salaryRecords).set({ finalizedBy: null }).where(eq(salaryRecords.finalizedBy, userId));
  await tx.update(salarySlipRequests).set({ decidedBy: null }).where(eq(salarySlipRequests.decidedBy, userId));
  await tx.update(noticePeriods).set({ decidedBy: null }).where(eq(noticePeriods.decidedBy, userId));
  await tx.update(companyAgreements).set({ createdBy: null }).where(eq(companyAgreements.createdBy, userId));
  await tx.update(salaryHolds).set({ releasedBy: null }).where(eq(salaryHolds.releasedBy, userId));
  await tx.update(auditLogs).set({ actorId: null }).where(eq(auditLogs.actorId, userId));
  // Corrections this person made to other people's attendance are NOT NULL; they go with the account.
  await tx.delete(attendanceAudit).where(eq(attendanceAudit.changedBy, userId));
  // Employees who reported to this person no longer have a manager set.
  await tx.update(employees).set({ managerId: null }).where(eq(employees.managerId, employeeId));
  await tx.delete(users).where(eq(users.id, userId));
}
