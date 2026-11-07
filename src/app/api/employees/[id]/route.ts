import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, employees, users } from "@/db/schema";
import { getAuth, hashPassword } from "@/lib/auth";
import { can, canSeeEmployee, loadAccess } from "@/lib/access";
import { shiftOf } from "@/lib/company";
import { parseIdList, replaceEmployeeOrg, validateOrgIds } from "@/lib/org";
import { isValidHHMM, parseHHMM } from "@/lib/payroll";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await loadAccess(ctx);
  if (!can(access, "manage_employees")) {
    return NextResponse.json({ error: "You do not have permission to edit employees." }, { status: 403 });
  }
  const companyId = ctx.company!.id;
  const { id } = await params;

  const emp = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
  if (!emp[0] || emp[0].companyId !== companyId || !(await canSeeEmployee(ctx, access, id))) {
    return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  }

  const body = await req.json();

  // Managers may update their team's details and org assignment. Salary, login status, password and role stay with admins.
  if (!access.isAdmin) {
    const adminOnly = body.basicSalary !== undefined || body.password !== undefined || body.isActive !== undefined || body.role !== undefined || body.managerId !== undefined;
    if (adminOnly) {
      return NextResponse.json({ error: "Only company admins can change salary, password, login status or role." }, { status: 403 });
    }
  }
  if (body.role !== undefined && body.role !== "employee") {
    return NextResponse.json({ error: "Create managers from the Managers page." }, { status: 400 });
  }
  const userUpdate: Record<string, unknown> = {};
  const empUpdate: Record<string, unknown> = {};

  if (typeof body.fullName === "string" && body.fullName.trim()) userUpdate.fullName = body.fullName.trim();
  if (typeof body.phone === "string") userUpdate.phone = body.phone.trim();
  if (typeof body.password === "string" && body.password) {
    if (body.password.length < 8) {
      return NextResponse.json({ error: "A new password must be at least 8 characters." }, { status: 400 });
    }
    userUpdate.passwordHash = hashPassword(body.password);
  }
  if (typeof body.employeeCode === "string") empUpdate.employeeCode = body.employeeCode.trim();
  if (typeof body.designation === "string") empUpdate.designation = body.designation.trim();

  // Shift (punch-in / punch-out time). Either can be changed; the result must stay a valid same-day range.
  if (body.shiftStart !== undefined || body.shiftEnd !== undefined) {
    const current = ctx.settings ? shiftOf(ctx.settings, emp[0]) : { start: "09:00", end: "18:00" };
    const nextStart = body.shiftStart !== undefined ? String(body.shiftStart) : current.start;
    const nextEnd = body.shiftEnd !== undefined ? String(body.shiftEnd) : current.end;
    if (!isValidHHMM(nextStart) || !isValidHHMM(nextEnd)) {
      return NextResponse.json({ error: "Punch-in and punch-out times must be valid times (HH:MM)." }, { status: 400 });
    }
    if (parseHHMM(nextEnd) <= parseHHMM(nextStart)) {
      return NextResponse.json({ error: "Punch-out time must be later than punch-in time." }, { status: 400 });
    }
    empUpdate.shiftStart = nextStart;
    empUpdate.shiftEnd = nextEnd;
  }
  if (body.basicSalary !== undefined && body.basicSalary !== "") {
    const salary = Number(body.basicSalary);
    if (!Number.isFinite(salary) || salary < 0) {
      return NextResponse.json({ error: "Basic salary must be zero or more." }, { status: 400 });
    }
    empUpdate.basicSalary = String(salary);
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
  // A manager can only assign departments and locations they are responsible for.
  if (!access.isAdmin) {
    if (departmentIds && !departmentIds.every((d) => access.departmentIds.includes(d))) {
      return NextResponse.json({ error: "You can only assign departments you manage." }, { status: 403 });
    }
    if (locationIds && access.locationIds.length > 0 && !locationIds.every((l) => access.locationIds.includes(l))) {
      return NextResponse.json({ error: "You can only assign work locations you manage." }, { status: 403 });
    }
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