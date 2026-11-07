import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, employees, users } from "@/db/schema";
import { getAuth, hashPassword } from "@/lib/auth";
import { can, loadAccess, visibleEmployeeIds } from "@/lib/access";
import { shiftOf } from "@/lib/company";
import { loadEmployeeOrg, parseIdList, replaceEmployeeOrg, validateOrgIds } from "@/lib/org";
import { isValidHHMM, parseHHMM } from "@/lib/payroll";

export async function GET() {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await loadAccess(ctx);
  if (access.isEmployee || ctx.user.role === "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const companyId = ctx.company!.id;
  // Admin: all employee accounts. Manager: their team only. Admins and managers are listed on the Managers page.
  const visible = await visibleEmployeeIds(ctx, access);
  const allRows = await db
    .select()
    .from(employees)
    .innerJoin(users, eq(employees.userId, users.id))
    .where(eq(employees.companyId, companyId))
    .orderBy(asc(users.fullName));
  const empRows = allRows.filter((r) => visible.has(r.employees.id));

  const orgByEmployee = await loadEmployeeOrg(empRows.map((r) => r.employees.id));

  return NextResponse.json({
    employees: empRows.map((r) => ({
      id: r.employees.id,
      userId: r.users.id,
      fullName: r.users.fullName,
      email: r.users.email,
      phone: r.users.phone,
      role: r.users.role,
      isActive: r.users.isActive,
      employeeCode: r.employees.employeeCode,
      // `department` is a display string built from the assigned departments (legacy text as fallback)
      department:
        (orgByEmployee.get(r.employees.id)?.departments.map((d) => d.name).join(", ") || r.employees.department) ?? null,
      departments: orgByEmployee.get(r.employees.id)?.departments ?? [],
      locations: orgByEmployee.get(r.employees.id)?.locations ?? [],
      designation: r.employees.designation,
      // effective shift = the employee's own times, or the company default if none were set
      shiftStart: ctx.settings ? shiftOf(ctx.settings, r.employees).start : r.employees.shiftStart,
      shiftEnd: ctx.settings ? shiftOf(ctx.settings, r.employees).end : r.employees.shiftEnd,
      // salary is confidential: managers never receive it
      basicSalary: access.isAdmin ? r.employees.basicSalary : null,
      hireDate: r.employees.hireDate,
    })),
  });
}

export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await loadAccess(ctx);
  if (!can(access, "manage_employees")) {
    return NextResponse.json({ error: "You do not have permission to add employees." }, { status: 403 });
  }
  const companyId = ctx.company!.id;

  const body = await req.json();
  if (body.role !== undefined && body.role !== "employee") {
    return NextResponse.json({ error: "Create managers from the Managers page." }, { status: 400 });
  }
  const fullName = String(body.fullName || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const role = "employee";
  const employeeCode = String(body.employeeCode || "").trim();
  const departmentIds = parseIdList(body.departmentIds);
  const locationIds = parseIdList(body.locationIds);
  const designation = String(body.designation || "").trim();
  // Shift: omitted -> company default; supplied -> must be valid and end after start.
  const defaultShift = ctx.settings ? shiftOf(ctx.settings, null) : { start: "09:00", end: "18:00" };
  const shiftStart = body.shiftStart ? String(body.shiftStart) : defaultShift.start;
  const shiftEnd = body.shiftEnd ? String(body.shiftEnd) : defaultShift.end;
  if (!isValidHHMM(shiftStart) || !isValidHHMM(shiftEnd)) {
    return NextResponse.json({ error: "Punch-in and punch-out times must be valid times (HH:MM)." }, { status: 400 });
  }
  if (parseHHMM(shiftEnd) <= parseHHMM(shiftStart)) {
    return NextResponse.json({ error: "Punch-out time must be later than punch-in time." }, { status: 400 });
  }
  // Salary is set by admins only; a manager-created employee starts at 0 until an admin sets it.
  if (!access.isAdmin && Number(body.basicSalary) > 0) {
    return NextResponse.json({ error: "Only company admins can set a salary." }, { status: 403 });
  }
  const basicSalary = access.isAdmin ? String(Number(body.basicSalary) || "0") : "0";
  const phone = String(body.phone || "").trim();

  if (!fullName || !email || password.length < 8) {
    return NextResponse.json({ error: "Name, email and a password (min 8 chars) are required." }, { status: 400 });
  }

  if (departmentIds.length === 0) {
    return NextResponse.json({ error: "Select at least one department for this employee." }, { status: 400 });
  }
  if (locationIds.length === 0) {
    return NextResponse.json({ error: "Select at least one work location for this employee." }, { status: 400 });
  }
  const orgError = await validateOrgIds(companyId, departmentIds, locationIds);
  if (orgError) return NextResponse.json({ error: orgError }, { status: 400 });

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
  }

  // A manager can only add people to departments and locations they are responsible for.
  if (!access.isAdmin) {
    if (!departmentIds.every((d) => access.departmentIds.includes(d))) {
      return NextResponse.json({ error: "You can only add people to departments you manage." }, { status: 403 });
    }
    if (access.locationIds.length > 0 && !locationIds.every((l) => access.locationIds.includes(l))) {
      return NextResponse.json({ error: "You can only add people to work locations you manage." }, { status: 403 });
    }
  }
  const hireDate = body.hireDate ? new Date(body.hireDate) : new Date();
  if (Number.isNaN(hireDate.getTime())) return NextResponse.json({ error: "Invalid hire date." }, { status: 400 });
  if (!(Number(body.basicSalary) >= 0)) return NextResponse.json({ error: "Basic salary must be zero or more." }, { status: 400 });

  try {
    const empId = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ companyId, email, passwordHash: hashPassword(password), fullName, role, phone })
        .returning();

      const [emp] = await tx
        .insert(employees)
        .values({ companyId, userId: user.id, employeeCode, designation, shiftStart, shiftEnd, basicSalary, hireDate })
        .returning();

      await replaceEmployeeOrg(tx, emp.id, departmentIds, locationIds);

      await tx.insert(auditLogs).values({
        companyId,
        actorId: ctx.user.id,
        action: "employee.create",
        entity: "employee",
        entityId: emp.id,
        details: { fullName, email, role, designation, shiftStart, shiftEnd, basicSalary, departmentIds, locationIds, createdByRole: ctx.user.role },
      });
      return emp.id;
    });
    return NextResponse.json({ ok: true, id: empId });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
    }
    console.error("employee create error", e);
    return NextResponse.json({ error: "Could not add the employee. Please try again." }, { status: 500 });
  }
}
