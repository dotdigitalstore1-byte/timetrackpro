import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendance, attendanceAudit, auditLogs } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { toClientRecord } from "@/lib/attendance-shape";
import { policyFrom } from "@/lib/company";
import { computeStatus } from "@/lib/payroll";

const STATUSES = ["present", "late", "half_day", "absent", "on_leave"];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
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
  if (ctx.user.role !== "company_admin") {
    return NextResponse.json({ error: "Only company admins can edit attendance." }, { status: 403 });
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
  if (!rec) return NextResponse.json({ error: "Attendance record not found." }, { status: 404 });

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

  // Status: explicit choice wins; otherwise re-derive from the new punch-in using the company policy.
  let newStatus = status;
  if (!newStatus && set.punchInTime && ctx.settings) newStatus = computeStatus(set.punchInTime as Date, policyFrom(ctx.settings));
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
