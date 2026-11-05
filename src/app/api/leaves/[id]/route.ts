import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, employees, leaveRequests, users } from "@/db/schema";
import { getAuth } from "@/lib/auth";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role === "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const companyId = ctx.company!.id;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const action = body.action === "reject" ? "reject" : body.action === "cancel" ? "cancel" : "approve";
  const reason = String(body.reason || "").trim().slice(0, 500);

  const leave = (await db.select().from(leaveRequests).where(and(eq(leaveRequests.id, id), eq(leaveRequests.companyId, companyId))).limit(1))[0];
  if (!leave) return NextResponse.json({ error: "Leave request not found." }, { status: 404 });
  if (leave.status !== "pending") return NextResponse.json({ error: "This request has already been processed." }, { status: 400 });

  // Employees may only cancel their own pending requests
  if (action === "cancel") {
    if (leave.employeeId !== ctx.employee?.id) return NextResponse.json({ error: "You can only cancel your own requests." }, { status: 403 });
    await db.update(leaveRequests).set({ status: "cancelled", updatedAt: new Date() }).where(eq(leaveRequests.id, id));
    await db.insert(auditLogs).values({ companyId, actorId: ctx.user.id, action: "leave.cancel", entity: "leave", entityId: id, details: {} });
    return NextResponse.json({ ok: true });
  }

  if (ctx.user.role === "employee") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const requester = (await db.select().from(employees).where(eq(employees.id, leave.employeeId)).limit(1))[0];
  const isAdmin = ctx.user.role === "company_admin";
  const isManager = ctx.user.role === "manager";
  const isLevel1Manager = isManager && !!requester && ctx.employee?.id === requester.managerId;

  // Nobody approves their own leave — unless the company has no other admin who could.
  let selfApproved = false;
  if (requester && ctx.employee?.id === requester.id) {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.companyId, companyId), eq(users.role, "company_admin"), eq(users.isActive, true)));
    const otherAdmin = admins.some((a) => a.id !== ctx.user.id);
    if (otherAdmin || !isAdmin) {
      return NextResponse.json({ error: "You cannot approve or reject your own leave request." }, { status: 403 });
    }
    selfApproved = true;
  }

  const levels = ctx.settings?.approvalLevels ?? 1;
  const currentLevel = leave.currentLevel;

  if (currentLevel === 1 && !isAdmin && !isLevel1Manager) {
    return NextResponse.json({ error: "You are not authorized to approve this request at this level." }, { status: 403 });
  }
  if (currentLevel === 2 && !isAdmin) {
    return NextResponse.json({ error: "Only a company admin can approve this final level." }, { status: 403 });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (action === "reject") {
    if (!reason) return NextResponse.json({ error: "Please give a reason for rejecting." }, { status: 400 });
    updates.status = "rejected";
    updates.rejectedBy = ctx.user.id;
    updates.rejectionReason = reason;
    if (currentLevel === 1) updates.level1Status = "rejected";
    if (currentLevel === 2) updates.level2Status = "rejected";
  } else if (currentLevel === 1) {
    updates.level1Status = "approved";
    // A manager's approval is level 1; with two levels configured an admin gives the final approval.
    if (levels >= 2 && !isAdmin) {
      updates.currentLevel = 2;
      updates.level2Status = "pending";
    } else {
      updates.status = "approved";
      updates.approvedBy = ctx.user.id;
      if (levels >= 2) updates.level2Status = "approved";
    }
  } else {
    updates.level2Status = "approved";
    updates.status = "approved";
    updates.approvedBy = ctx.user.id;
  }

  const [updated] = await db.update(leaveRequests).set(updates).where(eq(leaveRequests.id, id)).returning();
  await db.insert(auditLogs).values({ companyId, actorId: ctx.user.id, action: `leave.${action}`, entity: "leave", entityId: id, details: { level: currentLevel, reason, selfApproved } });
  return NextResponse.json({ ok: true, record: updated });
}
