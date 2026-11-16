import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, employeeDepartments, employeeLocations, employees, managerDepartments, managerLocations, users } from "@/db/schema";
import { getAuth } from "@/lib/auth";

/**
 * Promote an employee to manager. Their departments and locations carry over. Their employee profile is switched off,
 * so they stop punching and stop appearing on payroll, while every past record is kept. They keep their seat.
 * The admin then chooses the manager's powers on the Managers page.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Only company admins can promote employees." }, { status: 403 });
  const companyId = ctx.company!.id;
  const { id } = await params;

  const [emp] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
  if (!emp || emp.companyId !== companyId) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  if (emp.userId === ctx.user.id) return NextResponse.json({ error: "You cannot change your own role." }, { status: 400 });

  const [user] = await db.select().from(users).where(eq(users.id, emp.userId)).limit(1);
  if (!user || user.role !== "employee" || !user.isActive) {
    return NextResponse.json({ error: "Only an active employee can be promoted to manager." }, { status: 400 });
  }

  const depts = await db.select().from(employeeDepartments).where(eq(employeeDepartments.employeeId, emp.id));
  const locs = await db.select().from(employeeLocations).where(eq(employeeLocations.employeeId, emp.id));
  if (depts.length === 0 || locs.length === 0) {
    return NextResponse.json(
      { error: "Give this employee at least one department and one work location before promoting them." },
      { status: 400 }
    );
  }

  await db.transaction(async (tx) => {
    await tx.update(users).set({ role: "manager", managerPermissions: [] }).where(eq(users.id, user.id));
    await tx
      .insert(managerDepartments)
      .values(depts.map((d) => ({ userId: user.id, departmentId: d.departmentId })))
      .onConflictDoNothing();
    await tx
      .insert(managerLocations)
      .values(locs.map((l) => ({ userId: user.id, locationId: l.locationId })))
      .onConflictDoNothing();
    await tx.update(employees).set({ isActive: false }).where(eq(employees.id, emp.id));
    await tx.insert(auditLogs).values({
      companyId,
      actorId: ctx.user.id,
      action: "employee.promote",
      entity: "user",
      entityId: user.id,
      details: { fullName: user.fullName, previousRole: "employee", newRole: "manager" },
    });
  });
  return NextResponse.json({ ok: true });
}
