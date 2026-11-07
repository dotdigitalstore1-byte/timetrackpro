import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendance, attendanceAudit, auditLogs, employees } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { toClientRecord } from "@/lib/attendance-shape";
import { policyFor, shiftOf } from "@/lib/company";
import { computeStatus, earlyLeaveMinutesOf, overtimeMinutesOf } from "@/lib/payroll";
import { can, canSeeEmployee, loadAccess } from "@/lib/access";

const STATUSES = ["present", "late", "half_day", "absent", "on_leave"];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await loadAccess(ctx);
  if (!can(access, "manage_attendance")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const owner = (await db.select({ employeeId: attendance.employeeId }).from(attendance).where(and(eq(attendance.id, id), eq(attendance.companyId, ctx.company!.id))).limit(1))[0];
  if (!owner || !(await canSeeEmployee(ctx, access, owner.employeeId))) return NextResponse.json({ error: "Attendance record not found." }, { status: 404 });
  const trail = await db
    .select()
    .from(attendanceAudit)
    .where(and(eq(attendanceAudit.attendanceId, id), eq(attendanceAudit.companyId, ctx.company!.id)))
    .orderBy(desc(attendanceAudit.createdAt));
  return NextResponse.json({ audit: trail });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await loadAccess(ctx);
  if (!can(access, "manage_attendance")) {
    return NextResponse.json({ error: "You do not have permission to edit attendance." }, { status: 403 });
  }
  const companyId = ctx.company!.id;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const reason = String(body.reason || "").trim().slice(0, 500);
  if (reason.length < 3) return NextResponse.json({ error: "A reason is required for every attendance edit." }, { status: 400 });

  const parseDate = (v: unknown): Date | null | "invalid" => {
    if (v === undefined || v === null || v === "") return null;
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? "invalid" : d;
  };
  const punchIn = parseDate(body.punchInTime);
  const punchOut = parseDate(body.punchOutTime);
  if (punchIn === "invalid" || punchOut === "invalid") return NextResponse.json({ error: "Invalid date/time." }, { status: 400 });

  const status = body.status ? String(body.status) : "";
  if (status && !STATUSES.includes(status)) return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  const note = body.note !== undefined ? String(body.note).slice(0, 500) : null;

  const rec = (await db.select().from(attendance).where(and(eq(attendance.id, id), eq(attendance.companyId, companyId))).limit(1))[0];
  if (!rec || !(await canSeeEmployee(ctx, access, rec.employeeId))) {
    return NextResponse.json({ error: "Attendance record not found." }, { status: 404 });
  }

  const finalIn = punchIn ?? rec.punchInTime;
  const finalOut = punchOut ?? rec.punchOutTime;
  if (finalIn && finalOut && finalOut.getTime() <= finalIn.getTime()) {
    return NextResponse.json({ error: "Punch-out must be after punch-in." }, { status: 400 });
  }

  const changes: { field: string; oldValue: string; newValue: string }[] = [];
  const set: Record<string, unknown> = { updatedAt: new Date(), isManual: true };

  if (punchIn && punchIn.getTime() !== rec.punchInTime?.getTime()) {
    changes.push({ field: "punchInTime", oldValue: rec.punchInTime?.toISOString() ?? "", newValue: punchIn.toISOString() });
    set.punchInTime = punchIn;
  }
  if (punchOut && punchOut.getTime() !== rec.punchOutTime?.getTime()) {
    changes.push({ field: "punchOutTime", oldValue: rec.punchOutTime?.toISOString() ?? "", newValue: punchOut.toISOString() });
    set.punchOutTime = punchOut;
  }

  // The employee's own shift drives status, early leave and overtime.
  const emp = (await db.select().from(employees).where(eq(employees.id, rec.employeeId)).limit(1))[0];
  const shift = ctx.settings ? shiftOf(ctx.settings, emp) : null;
  const tz = ctx.settings?.timezone || "UTC";
  if (shift && (set.punchOutTime || set.punchInTime) && finalOut) {
    const early = earlyLeaveMinutesOf(finalOut, rec.workDate, shift.end, tz);
    const overtime = overtimeMinutesOf(finalOut, rec.workDate, shift.end, tz);
    if (early !== rec.earlyLeaveMinutes) set.earlyLeaveMinutes = early;
    if (overtime !== rec.overtimeMinutes) set.overtimeMinutes = overtime;
  }

  // Status: explicit choice wins; otherwise re-derive from the new punch-in using the company policy.
  let newStatus = status;
  if (!newStatus && set.punchInTime && ctx.settings) newStatus = computeStatus(set.punchInTime as Date, policyFor(ctx.settings, emp));
  if (newStatus && newStatus !== rec.status) {
    changes.push({ field: "status", oldValue: rec.status, newValue: newStatus });
    set.status = newStatus;
  }
  if (note !== null && note !== (rec.note ?? "")) {
    changes.push({ field: "note", oldValue: rec.note ?? "", newValue: note });
    set.note = note;
  }

  if (changes.length === 0) return NextResponse.json({ ok: true, message: "No changes" });

  const updated = await db.transaction(async (tx) => {
    const [u] = await tx.update(attendance).set(set).where(eq(attendance.id, id)).returning();
    await tx.insert(attendanceAudit).values(
      changes.map((ch) => ({ companyId, attendanceId: id, changedBy: ctx.user.id, field: ch.field, oldValue: ch.oldValue, newValue: ch.newValue, reason }))
    );
    await tx.insert(auditLogs).values({ companyId, actorId: ctx.user.id, action: "attendance.edit", entity: "attendance", entityId: id, details: { changes, reason } });
    return u;
  });

  return NextResponse.json({ ok: true, record: toClientRecord(updated), changes });
}

/** Remove an attendance record. The removed record is kept in the company audit log; its edit trail goes with it. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await loadAccess(ctx);
  if (!can(access, "manage_attendance")) {
    return NextResponse.json({ error: "You do not have permission to remove attendance." }, { status: 403 });
  }
  const companyId = ctx.company!.id;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = String(body.reason || "").trim().slice(0, 500);
  if (reason.length < 3) return NextResponse.json({ error: "A reason is required to remove attendance." }, { status: 400 });

  const rec = (await db.select().from(attendance).where(and(eq(attendance.id, id), eq(attendance.companyId, companyId))).limit(1))[0];
  if (!rec || !(await canSeeEmployee(ctx, access, rec.employeeId))) {
    return NextResponse.json({ error: "Attendance record not found." }, { status: 404 });
  }

  await db.transaction(async (tx) => {
    await tx.insert(auditLogs).values({
      companyId,
      actorId: ctx.user.id,
      action: "attendance.delete",
      entity: "attendance",
      entityId: id,
      details: {
        reason,
        employeeId: rec.employeeId,
        workDate: rec.workDate.toISOString(),
        punchInTime: rec.punchInTime?.toISOString() ?? null,
        punchOutTime: rec.punchOutTime?.toISOString() ?? null,
        status: rec.status,
      },
    });
    await tx.delete(attendance).where(eq(attendance.id, id));
  });
  return NextResponse.json({ ok: true });
}
