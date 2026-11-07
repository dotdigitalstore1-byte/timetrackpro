import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, departments, geofences, managerDepartments, managerLocations, users } from "@/db/schema";
import { getAuth, hashPassword } from "@/lib/auth";
import { scopeEmployeeIds, validPermissions, MANAGER_PERMISSIONS, type Access } from "@/lib/access";
import { parseIdList, validateOrgIds } from "@/lib/org";

/** Managers: the company admin creates them, chooses their departments/locations and the powers they get. */
export async function GET() {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const companyId = ctx.company!.id;

  const [managers, deptLinks, locLinks, depts, locs] = await Promise.all([
    db.select().from(users).where(and(eq(users.companyId, companyId), eq(users.role, "manager"))).orderBy(asc(users.fullName)),
    db
      .select({ userId: managerDepartments.userId, id: departments.id, name: departments.name })
      .from(managerDepartments)
      .innerJoin(departments, eq(managerDepartments.departmentId, departments.id))
      .innerJoin(users, eq(managerDepartments.userId, users.id))
      .where(eq(users.companyId, companyId)),
    db
      .select({ userId: managerLocations.userId, id: geofences.id, name: geofences.name })
      .from(managerLocations)
      .innerJoin(geofences, eq(managerLocations.locationId, geofences.id))
      .innerJoin(users, eq(managerLocations.userId, users.id))
      .where(eq(users.companyId, companyId)),
    db.select({ id: departments.id, name: departments.name, isActive: departments.isActive }).from(departments).where(eq(departments.companyId, companyId)).orderBy(asc(departments.name)),
    db.select({ id: geofences.id, name: geofences.name, isActive: geofences.isActive }).from(geofences).where(eq(geofences.companyId, companyId)).orderBy(asc(geofences.name)),
  ]);

  const rows = await Promise.all(
    managers.map(async (m) => {
      const access: Access = {
        isAdmin: false,
        isManager: true,
        isEmployee: false,
        permissions: validPermissions(m.managerPermissions),
        departmentIds: deptLinks.filter((d) => d.userId === m.id).map((d) => d.id),
        locationIds: locLinks.filter((l) => l.userId === m.id).map((l) => l.id),
      };
      const team = await scopeEmployeeIds(companyId, access, null);
      return {
        id: m.id,
        fullName: m.fullName,
        email: m.email,
        phone: m.phone,
        isActive: m.isActive,
        permissions: access.permissions,
        departments: deptLinks.filter((d) => d.userId === m.id).map((d) => ({ id: d.id, name: d.name })),
        locations: locLinks.filter((l) => l.userId === m.id).map((l) => ({ id: l.id, name: l.name })),
        teamSize: team.size,
      };
    })
  );

  return NextResponse.json({
    managers: rows,
    permissionCatalog: MANAGER_PERMISSIONS,
    departments: depts,
    locations: locs,
  });
}

export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Only company admins can add managers." }, { status: 403 });
  const companyId = ctx.company!.id;

  const body = await req.json();
  const fullName = String(body.fullName || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const phone = String(body.phone || "").trim();
  const departmentIds = parseIdList(body.departmentIds);
  const locationIds = parseIdList(body.locationIds);
  const permissions = validPermissions(body.permissions);

  if (!fullName || !email || password.length < 8) {
    return NextResponse.json({ error: "Name, email and a password (min 8 characters) are required." }, { status: 400 });
  }
  if (departmentIds.length === 0) {
    return NextResponse.json({ error: "Choose at least one department for this manager." }, { status: 400 });
  }
  if (locationIds.length === 0) {
    return NextResponse.json({ error: "Choose at least one work location for this manager." }, { status: 400 });
  }
  const orgError = await validateOrgIds(companyId, departmentIds, locationIds);
  if (orgError) return NextResponse.json({ error: orgError }, { status: 400 });

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });

  try {
    const id = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ companyId, email, passwordHash: hashPassword(password), fullName, role: "manager", phone, managerPermissions: permissions })
        .returning();
      await tx.insert(managerDepartments).values(departmentIds.map((departmentId) => ({ userId: user.id, departmentId })));
      await tx.insert(managerLocations).values(locationIds.map((locationId) => ({ userId: user.id, locationId })));
      await tx.insert(auditLogs).values({
        companyId,
        actorId: ctx.user.id,
        action: "manager.create",
        entity: "user",
        entityId: user.id,
        details: { fullName, email, departmentIds, locationIds, permissions },
      });
      return user.id;
    });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "A user with this email already exists." }, { status: 409 });
    }
    console.error("manager create error", e);
    return NextResponse.json({ error: "Could not add the manager. Please try again." }, { status: 500 });
  }
}


