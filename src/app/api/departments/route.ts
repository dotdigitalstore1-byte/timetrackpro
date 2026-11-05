import { NextResponse } from "next/server";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, departments, employeeDepartments } from "@/db/schema";
import { getAuth } from "@/lib/auth";

export async function GET() {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin" && ctx.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const companyId = ctx.company!.id;

  const rows = await db
    .select({
      id: departments.id,
      name: departments.name,
      description: departments.description,
      isActive: departments.isActive,
      createdAt: departments.createdAt,
      employeeCount: count(employeeDepartments.employeeId),
    })
    .from(departments)
    .leftJoin(employeeDepartments, eq(employeeDepartments.departmentId, departments.id))
    .where(eq(departments.companyId, companyId))
    .groupBy(departments.id)
    .orderBy(asc(sql`lower(${departments.name})`));

  return NextResponse.json({
    departments: rows.map((r) => ({ ...r, employeeCount: Number(r.employeeCount) })),
  });
}

export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") {
    return NextResponse.json({ error: "Only company admins can add departments." }, { status: 403 });
  }
  const companyId = ctx.company!.id;

  let body: { name?: unknown; description?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim().replace(/\s+/g, " ");
  const description = String(body.description ?? "").trim().slice(0, 500);
  if (!name) return NextResponse.json({ error: "Department name is required." }, { status: 400 });
  if (name.length > 100) return NextResponse.json({ error: "Department name must be 100 characters or fewer." }, { status: 400 });

  const dup = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.companyId, companyId), sql`lower(${departments.name}) = ${name.toLowerCase()}`))
    .limit(1);
  if (dup[0]) return NextResponse.json({ error: `A department named “${name}” already exists.` }, { status: 409 });

  try {
    const [row] = await db
      .insert(departments)
      .values({ companyId, name, description: description || null })
      .returning();
    await db.insert(auditLogs).values({
      companyId,
      actorId: ctx.user.id,
      action: "department.create",
      entity: "department",
      entityId: row.id,
      details: { name },
    });
    return NextResponse.json({ ok: true, department: { ...row, employeeCount: 0 } });
  } catch (e) {
    // Two admins adding the same name at once: the unique index wins.
    if ((e as { code?: string }).code === "23505") {
      return NextResponse.json({ error: `A department named “${name}” already exists.` }, { status: 409 });
    }
    console.error("department create error", e);
    return NextResponse.json({ error: "Could not add the department. Please try again." }, { status: 500 });
  }
}
