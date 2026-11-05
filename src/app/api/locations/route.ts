import { NextResponse } from "next/server";
import { asc, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, employeeLocations, geofences } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { parseLocationInput } from "@/lib/locations";

export async function GET() {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin" && ctx.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const companyId = ctx.company!.id;

  const rows = await db
    .select({
      id: geofences.id,
      name: geofences.name,
      address: geofences.address,
      latitude: geofences.latitude,
      longitude: geofences.longitude,
      radiusMeters: geofences.radiusMeters,
      isActive: geofences.isActive,
      createdAt: geofences.createdAt,
      employeeCount: count(employeeLocations.employeeId),
    })
    .from(geofences)
    .leftJoin(employeeLocations, eq(employeeLocations.locationId, geofences.id))
    .where(eq(geofences.companyId, companyId))
    .groupBy(geofences.id)
    .orderBy(asc(sql`lower(${geofences.name})`));

  return NextResponse.json({
    locations: rows.map((r) => ({ ...r, employeeCount: Number(r.employeeCount) })),
  });
}

export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") {
    return NextResponse.json({ error: "Only company admins can add locations." }, { status: 403 });
  }
  const companyId = ctx.company!.id;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = parseLocationInput(body, false);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;

  const dup = await db
    .select({ id: geofences.id })
    .from(geofences)
    .where(sql`${geofences.companyId} = ${companyId} and lower(${geofences.name}) = ${String(v.name).toLowerCase()}`)
    .limit(1);
  if (dup[0]) return NextResponse.json({ error: `A location named “${v.name}” already exists.` }, { status: 409 });

  const [row] = await db
    .insert(geofences)
    .values({
      companyId,
      name: v.name!,
      address: v.address ?? null,
      latitude: v.latitude!,
      longitude: v.longitude!,
      radiusMeters: v.radiusMeters!,
      isActive: v.isActive ?? true,
    })
    .returning();

  await db.insert(auditLogs).values({
    companyId,
    actorId: ctx.user.id,
    action: "location.create",
    entity: "location",
    entityId: row.id,
    details: { name: v.name, radiusMeters: v.radiusMeters },
  });
  return NextResponse.json({ ok: true, location: { ...row, employeeCount: 0 } });
}
