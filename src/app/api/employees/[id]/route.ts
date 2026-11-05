import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, employees, users } from "@/db/schema";
import { getAuth, hashPassword } from "@/lib/auth";
import { parseIdList, replaceEmployeeOrg, validateOrgIds } from "@/lib/org";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") {
    return NextResponse.json({ error: "Only company admins can edit employees." }, { status: 403 });
  }
  const companyId = ctx.company!.id;
  const { id } = await params;

  const emp = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
  if (!emp[0] || emp[0].companyId !== companyId) {
    return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  }

  const body = await req.json();
  const userUpdate: Record<string, unknown> = {};
  const empUpdate: Record<string, unknown> = {};

  if (typeof body.fullName === "string" && body.fullName.trim()) userUpdate.fullName = body.fullName.trim();
  if (typeof body.phone === "string") userUpdate.phone = body.phone.trim();
  if (typeof body.role === "string" && ["employee", "manager"].includes(body.role)) userUpdate.role = body.role;
  if (typeof body.password === "string" && body.password) {
    if (body.password.length < 8) {
      return NextResponse.json({ error: "A new password must be at least 8 characters." }, { status: 400 });
    }
    userUpdate.passwordHash = hashPassword(body.password);
  }
  if (typeof body.employeeCode === "string") empUpdate.employeeCode = body.employeeCode.trim();
  if (typeof body.designation === "string") empUpdate.designation = body.designation.trim();
  if (body.basicSalary !== undefined && body.basicSalary !== "") {
    const salary = Number(body.basicSalary);
    if (!Number.isFinite(salary) || salary < 0) {
      return NextResponse.json({ error: "Basic salary must be zero or more." }, { status: 400 });
    }
    empUpdate.basicSalary = String(salary);
  }
  if (body.managerId !== undefined) {
    const mid = body.managerId ? String(body.managerId) : null;
    if (mid) {
      if (mid === id) return NextResponse.json({ error: "An employee cannot be their own manager." }, { status: 400 });
      const m = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, mid), eq(employees.companyId, companyId))).limit(1);
      if (!m[0]) return NextResponse.json({ error: "Selected manager was not found in your company." }, { status: 400 });
    }
    empUpdate.managerId = mid;
  }
  if (typeof body.isActive === "boolean") {
    if (!body.isActive && emp[0].userId === ctx.user.id) {
      return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 400 });
    }
    empUpdate.isActive = body.isActive;
    userUpdate.isActive = body.isActive;
  }

  // Departments / locations: when supplied they replace the previous assignment and must not be empty.
  let departmentIds: string[] | undefined;
  let locationIds: string[] | undefined;
  if (body.departmentIds !== undefined) {
    departmentIds = parseIdList(body.departmentIds);
    if (departmentIds.length === 0) {
      return NextResponse.json({ error: "Select at least one department for this employee." }, { status: 400 });
    }
  }
  if (body.locationIds !== undefined) {
    locationIds = parseIdList(body.locationIds);
    if (locationIds.length === 0) {
      return NextResponse.json({ error: "Select at least one work location for this employee." }, { status: 400 });
    }
  }
  if (departmentIds || locationIds) {
    const orgError = await validateOrgIds(companyId, departmentIds ?? [], locationIds ?? []);
    if (orgError) return NextResponse.json({ error: orgError }, { status: 400 });
  }

  await db.transaction(async (tx) => {
    if (Object.keys(userUpdate).length) {
      await tx.update(users).set(userUpdate).where(eq(users.id, emp[0].userId));
    }
    if (Object.keys(empUpdate).length) {
      await tx.update(employees).set(empUpdate).where(eq(employees.id, id));
    }
    await replaceEmployeeOrg(tx, id, departmentIds, locationIds);
  });

  const safeUserUpdate = { ...userUpdate };
  delete safeUserUpdate.passwordHash;
  await db.insert(auditLogs).values({
    companyId,
    actorId: ctx.user.id,
    action: "employee.update",
    entity: "employee",
    entityId: id,
    details: { userUpdate: safeUserUpdate, empUpdate, departmentIds, locationIds, passwordChanged: !!userUpdate.passwordHash },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") {
    return NextResponse.json({ error: "Only company admins can remove employees." }, { status: 403 });
  }
  const companyId = ctx.company!.id;
  const { id } = await params;

  const emp = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
  if (!emp[0] || emp[0].companyId !== companyId) {
    return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  }

  if (emp[0].userId === ctx.user.id) {
    return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 400 });
  }
  await db.update(employees).set({ isActive: false }).where(eq(employees.id, id));
  await db.update(users).set({ isActive: false }).where(eq(users.id, emp[0].userId));

  await db.insert(auditLogs).values({
    companyId,
    actorId: ctx.user.id,
    action: "employee.deactivate",
    entity: "employee",
    entityId: id,
    details: { fullName: emp[0].id },
  });

  return NextResponse.json({ ok: true });
}