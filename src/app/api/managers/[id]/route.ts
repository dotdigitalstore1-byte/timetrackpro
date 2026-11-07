import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, managerDepartments, managerLocations, users } from "@/db/schema";
import { getAuth, hashPassword } from "@/lib/auth";
import { validPermissions } from "@/lib/access";
import { parseIdList, validateOrgIds } from "@/lib/org";

/** Update a manager: details, departments, locations, powers, login status. Admin only. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Only company admins can change managers." }, { status: 403 });
  const companyId = ctx.company!.id;
  const { id } = await params;

  const target = (await db.select().from(users).where(and(eq(users.id, id), eq(users.companyId, companyId), eq(users.role, "manager"))).limit(1))[0];
  if (!target) return NextResponse.json({ error: "Manager not found." }, { status: 404 });

  const body = await req.json();
  const userUpdate: Record<string, unknown> = {};
  if (typeof body.fullName === "string" && body.fullName.trim()) userUpdate.fullName = body.fullName.trim();
  if (typeof body.phone === "string") userUpdate.phone = body.phone.trim();
  if (Array.isArray(body.permissions)) userUpdate.managerPermissions = validPermissions(body.permissions);
  if (typeof body.isActive === "boolean") {
    if (!body.isActive && target.id === ctx.user.id) {
      return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 400 });
    }
    userUpdate.isActive = body.isActive;
  }
  if (typeof body.password === "string" && body.password) {
    if (body.password.length < 8) return NextResponse.json({ error: "A new password must be at least 8 characters." }, { status: 400 });
    userUpdate.passwordHash = hashPassword(body.password);
  }

  let departmentIds: string[] | undefined;
  let locationIds: string[] | undefined;
  if (body.departmentIds !== undefined) {
    departmentIds = parseIdList(body.departmentIds);
    if (departmentIds.length === 0) return NextResponse.json({ error: "Choose at least one department for this manager." }, { status: 400 });
  }
  if (body.locationIds !== undefined) {
    locationIds = parseIdList(body.locationIds);
    if (locationIds.length === 0) return NextResponse.json({ error: "Choose at least one work location for this manager." }, { status: 400 });
  }
  if (departmentIds || locationIds) {
    const orgError = await validateOrgIds(companyId, departmentIds ?? [], locationIds ?? []);
    if (orgError) return NextResponse.json({ error: orgError }, { status: 400 });
  }

  await db.transaction(async (tx) => {
    if (Object.keys(userUpdate).length) await tx.update(users).set(userUpdate).where(eq(users.id, id));
    if (departmentIds) {
      await tx.delete(managerDepartments).where(eq(managerDepartments.userId, id));
      await tx.insert(managerDepartments).values(departmentIds.map((departmentId) => ({ userId: id, departmentId })));
    }
    if (locationIds) {
      await tx.delete(managerLocations).where(eq(managerLocations.userId, id));
      await tx.insert(managerLocations).values(locationIds.map((locationId) => ({ userId: id, locationId })));
    }
    const safe = { ...userUpdate };
    delete safe.passwordHash;
    await tx.insert(auditLogs).values({
      companyId,
      actorId: ctx.user.id,
      action: "manager.update",
      entity: "user",
      entityId: id,
      details: { changes: safe, departmentIds, locationIds, passwordChanged: !!userUpdate.passwordHash },
    });
  });
  return NextResponse.json({ ok: true });
}
