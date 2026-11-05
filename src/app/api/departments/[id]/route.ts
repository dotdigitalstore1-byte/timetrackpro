import { NextResponse } from "next/server";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, departments } from "@/db/schema";
import { getAuth } from "@/lib/auth";

async function adminCtx() {
  const ctx = await getAuth();
  if (!ctx) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), ctx: null };
  if (ctx.user.role !== "company_admin") {
    return { error: NextResponse.json({ error: "Only company admins can manage departments." }, { status: 403 }), ctx: null };
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
    .from(departments)
    .where(and(eq(departments.id, id), eq(departments.companyId, companyId)))
    .limit(1);
  if (!found[0]) return NextResponse.json({ error: "Department not found." }, { status: 404 });

  let body: { name?: unknown; description?: unknown; isActive?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const update: Partial<typeof departments.$inferInsert> = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim().replace(/\s+/g, " ");
    if (!name) return NextResponse.json({ error: "Department name is required." }, { status: 400 });
    if (name.length > 100) return NextResponse.json({ error: "Department name must be 100 characters or fewer." }, { status: 400 });
    const dup = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.companyId, companyId), ne(departments.id, id), sql`lower(${departments.name}) = ${name.toLowerCase()}`))
      .limit(1);
    if (dup[0]) return NextResponse.json({ error: `A department named “${name}” already exists.` }, { status: 409 });
    update.name = name;
  }
  if (body.description !== undefined) update.description = String(body.description).trim().slice(0, 500) || null;
  if (typeof body.isActive === "boolean") update.isActive = body.isActive;

  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true });

  try {
    await db.update(departments).set(update).where(and(eq(departments.id, id), eq(departments.companyId, companyId)));
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "A department with this name already exists." }, { status: 409 });
    }
    throw e;
  }
  await db.insert(auditLogs).values({
    companyId,
    actorId: a.ctx.user.id,
    action: "department.update",
    entity: "department",
    entityId: id,
    details: update as Record<string, unknown>,
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
    .from(departments)
    .where(and(eq(departments.id, id), eq(departments.companyId, companyId)))
    .limit(1);
  if (!found[0]) return NextResponse.json({ error: "Department not found." }, { status: 404 });

  // employee_departments rows are removed by ON DELETE CASCADE; employees themselves are untouched.
  await db.delete(departments).where(and(eq(departments.id, id), eq(departments.companyId, companyId)));
  await db.insert(auditLogs).values({
    companyId,
    actorId: a.ctx.user.id,
    action: "department.delete",
    entity: "department",
    entityId: id,
    details: { name: found[0].name },
  });
  return NextResponse.json({ ok: true });
}
