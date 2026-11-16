import { NextResponse } from "next/server";
import { and, eq, gte, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { attendance, auditLogs, salaryRecords } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { can, canSeeEmployee, loadAccess } from "@/lib/access";

/**
 * Excuse (or un-excuse) a late arrival. An excused late counts as a full day present with no late deduction. Because the
 * salary is recalculated from the records, the deduction and any late-marks penalty reverse on the spot. Pay cycles that
 * are already finalized cannot change.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role === "super_admin" || !ctx.company) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const access = await loadAccess(ctx);
  if (!access.isAdmin && !can(access, "manage_attendance")) {
    return NextResponse.json({ error: "You do not have permission to excuse late arrivals." }, { status: 403 });
  }
  const companyId = ctx.company.id;
  const { id } = await params;

  const [rec] = await db.select().from(attendance).where(and(eq(attendance.id, id), eq(attendance.companyId, companyId))).limit(1);
  if (!rec) return NextResponse.json({ error: "Attendance record not found." }, { status: 404 });
  if (!access.isAdmin && !(await canSeeEmployee(ctx, access, rec.employeeId))) {
    return NextResponse.json({ error: "You can only excuse people on your team." }, { status: 403 });
  }
  if (rec.status !== "late") return NextResponse.json({ error: "Only late arrivals can be excused." }, { status: 400 });

  const [finalized] = await db
    .select({ id: salaryRecords.id })
    .from(salaryRecords)
    .where(
      and(
        eq(salaryRecords.companyId, companyId),
        eq(salaryRecords.employeeId, rec.employeeId),
        ne(salaryRecords.status, "draft"),
        lte(salaryRecords.periodStart, rec.workDate),
        gte(salaryRecords.periodEnd, rec.workDate)
      )
    )
    .limit(1);
  if (finalized) {
    return NextResponse.json({ error: "This pay cycle is already finalized, so its deductions can no longer change." }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const excused = body.excused === true;
  const reason = excused ? String(body.reason || "").trim().slice(0, 200) || null : null;
  await db
    .update(attendance)
    .set({ excused, excusedReason: reason, excusedBy: excused ? ctx.user.id : null, excusedAt: excused ? new Date() : null })
    .where(eq(attendance.id, id));
  await db.insert(auditLogs).values({
    companyId,
    actorId: ctx.user.id,
    action: excused ? "attendance.excuse_late" : "attendance.unexcuse_late",
    entity: "attendance",
    entityId: id,
    details: { reason, employeeId: rec.employeeId },
  });
  return NextResponse.json({ ok: true, excused });
}
