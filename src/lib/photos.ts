import { and, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { attendance, companySettings, employees, salaryRecords } from "@/db/schema";
import { localWorkDate, photoCutoff, recordCutoff, recentCycles } from "@/lib/payroll";

/**
 * Deletes punch photos whose work date is older than the retention window (45 days).
 * The attendance row, times, status and salary figures are kept; only the image data is removed.
 * Safe to run repeatedly. Returns how many attendance rows lost a photo.
 */
export async function purgeExpiredPhotos(now: Date = new Date(), companyId?: string): Promise<number> {
  const cutoff = photoCutoff(localWorkDate(now, "UTC"));
  const rows = await db
    .update(attendance)
    .set({ punchInPhoto: null, punchOutPhoto: null, updatedAt: now })
    .where(
      and(
        companyId ? eq(attendance.companyId, companyId) : undefined,
        lt(attendance.workDate, cutoff),
        or(isNotNull(attendance.punchInPhoto), isNotNull(attendance.punchOutPhoto))
      )
    )
    .returning({ id: attendance.id });
  return rows.length;
}

/** Unfinalized salary cycles this far back (including the cutoff's own cycle) keep their attendance rows. */
const RETENTION_GUARD_CYCLES = 13;

/**
 * Deletes attendance ROWS (times, status, GPS, no photo) older than the 90-day record window.
 *
 * Safety: an employee's rows are never deleted while a salary cycle that uses them is still unfinalized. Within the
 * last 13 cycles, any cycle without a finalized or paid salary for that employee holds back deletion to its start.
 * Finalized and paid months are stored in salary_records, so they never need the attendance rows again.
 * Returns how many attendance rows were deleted.
 */
export async function purgeOldAttendance(now: Date = new Date()): Promise<number> {
  const cutoff = recordCutoff(localWorkDate(now, "UTC"));

  const [withOldRows, finalized, settingsRows, staff] = await Promise.all([
    db
      .selectDistinct({ employeeId: attendance.employeeId, companyId: attendance.companyId })
      .from(attendance)
      .where(lt(attendance.workDate, cutoff)),
    db
      .selectDistinct({ employeeId: salaryRecords.employeeId, year: salaryRecords.year, month: salaryRecords.month })
      .from(salaryRecords)
      .where(inArray(salaryRecords.status, ["finalized", "paid"])),
    db.select({ companyId: companySettings.companyId, startDay: companySettings.salaryCycleStartDay }).from(companySettings),
    db.select({ id: employees.id, hireDate: employees.hireDate }).from(employees),
  ]);

  const startDayOf = new Map(settingsRows.map((r) => [r.companyId, r.startDay]));
  const hireOf = new Map(staff.map((e) => [e.id, e.hireDate]));
  const paidCycles = new Set(
    finalized.map((f) => `${f.employeeId}|${f.year}-${String(f.month).padStart(2, "0")}`)
  );

  let deleted = 0;
  for (const row of withOldRows) {
    const startDay = startDayOf.get(row.companyId) ?? 1;
    const hire = hireOf.get(row.employeeId);
    const hireDay = hire ? new Date(Date.UTC(hire.getUTCFullYear(), hire.getUTCMonth(), hire.getUTCDate())) : null;

    let limit = cutoff;
    for (const cycle of recentCycles(cutoff, startDay, RETENTION_GUARD_CYCLES)) {
      if (hireDay && cycle.end.getTime() < hireDay.getTime()) continue; // before the employee joined
      if (paidCycles.has(`${row.employeeId}|${cycle.key}`)) continue; // finalized: no longer needs these rows
      if (cycle.start.getTime() < limit.getTime()) limit = cycle.start;
    }

    const removed = await db
      .delete(attendance)
      .where(and(eq(attendance.employeeId, row.employeeId), lt(attendance.workDate, limit)))
      .returning({ id: attendance.id });
    deleted += removed.length;
  }
  return deleted;
}
