import { and, eq, isNotNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { attendance } from "@/db/schema";
import { localWorkDate, photoCutoff } from "@/lib/payroll";

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
