import { NextResponse } from "next/server";
import { and, count, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, employeeLocations, geofences } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { parseLocationInput } from "@/lib/locations";

async function adminCtx() {
  const ctx = await getAuth();
  if (!ctx) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), ctx: null };
  if (ctx.user.role !== "company_admin") {
    return { error: NextResponse.json({ error: "Only company admins can manage locations." }, { status: 403 }), ctx: null };
  }
  return { error: null, ctx };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await adminCtx();
  if (a.error) return a.error;
  const companyId = a.ctx.company!.id;
  const { id } = await params;

  const found = await db
    .select()
    .from(geofences)
    .where(and(eq(geofences.id, id), eq(geofences.companyId, companyId)))
    .limit(1);
  if (!found[0]) return NextResponse.json({ error: "Location not found." }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = parseLocationInput(body, true);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;

  if (v.name) {
    const dup = await db
      .select({ id: geofences.id })
      .from(geofences)
      .where(and(eq(geofences.companyId, companyId), ne(geofences.id, id), sql`lower(${geofences.name}) = ${v.name.toLowerCase()}`))
      .limit(1);
    if (dup[0]) return NextResponse.json({ error: `A location named “${v.name}” already exists.` }, { status: 409 });
  }

  if (Object.keys(v).length === 0) return NextResponse.json({ ok: true });

  await db.update(geofences).set(v).where(and(eq(geofences.id, id), eq(geofences.companyId, companyId)));
  await db.insert(auditLogs).values({
    companyId,
    actorId: a.ctx.user.id,
    action: "location.update",
    entity: "location",
    entityId: id,
    details: v as Record<string, unknown>,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await adminCtx();
  if (a.error) return a.error;
  const companyId = a.ctx.company!.id;
  const { id } = await params;

  const found = await db
    .select()
    .from(geofences)
    .where(and(eq(geofences.id, id), eq(geofences.companyId, companyId)))
    .limit(1);
  if (!found[0]) return NextResponse.json({ error: "Location not found." }, { status: 404 });

  // Deleting a location that employees are assigned to would silently let them punch from
  // any other company location, so make the admin reassign (or deactivate) first.
  const assigned = await db
    .select({ n: count() })
    .from(employeeLocations)
    .where(eq(employeeLocations.locationId, id));
  const n = Number(assigned[0]?.n ?? 0);
  if (n > 0) {
    return NextResponse.json(
      {
        error: `${n} employee${n === 1 ? " is" : "s are"} assigned to this location. Reassign them in Employees, or deactivate the location instead.`,
      },
      { status: 409 }
    );
  }

  await db.delete(geofences).where(and(eq(geofences.id, id), eq(geofences.companyId, companyId)));
  await db.insert(auditLogs).values({
    companyId,
    actorId: a.ctx.user.id,
    action: "location.delete",
    entity: "location",
    entityId: id,
    details: { name: found[0].name },
  });
  return NextResponse.json({ ok: true });
}
