import { NextResponse } from "next/server";
import { and, count, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { attendance, companies, companySettings, employees, subscriptions, users } from "@/db/schema";
import { getAuth, hashPassword } from "@/lib/auth";

export async function GET() {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const companyRows = await db
    .select({
      company: companies,
      employeeCount: count(employees.id),
    })
    .from(companies)
    .leftJoin(employees, eq(employees.companyId, companies.id))
    .groupBy(companies.id)
    .orderBy(desc(companies.createdAt));

  const subs = await db.select().from(subscriptions);
  const subByCompany = new Map(subs.map((s) => [s.companyId, s]));

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrow = new Date(today.getTime() + 86400000);
  const todayAttendance = await db
    .select()
    .from(attendance)
    .where(and(gte(attendance.workDate, today), lt(attendance.workDate, tomorrow)));
  const presentToday = new Set(todayAttendance.filter((a) => a.punchInTime).map((a) => a.companyId)).size;

  const totalEmployees = companyRows.reduce((s, r) => s + Number(r.employeeCount), 0);

  return NextResponse.json({
    stats: {
      totalCompanies: companyRows.length,
      activeCompanies: companyRows.filter((r) => r.company.status === "active").length,
      totalEmployees,
      presentCompaniesToday: presentToday,
    },
    companies: companyRows.map((r) => ({
      id: r.company.id,
      name: r.company.name,
      email: r.company.email,
      phone: r.company.phone,
      status: r.company.status,
      subscriptionPlan: r.company.subscriptionPlan,
      employeeCount: Number(r.employeeCount),
      subscription: subByCompany.get(r.company.id)
        ? {
            plan: subByCompany.get(r.company.id)!.plan,
            amount: subByCompany.get(r.company.id)!.amount,
            status: subByCompany.get(r.company.id)!.status,
            endDate: subByCompany.get(r.company.id)!.endDate,
          }
        : null,
      createdAt: r.company.createdAt,
    })),
  });
}

export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const action = String(body.action || "");

  if (action === "updateCompany") {
    const companyId = String(body.companyId || "");
    const status = ["active", "suspended", "deactivated"].includes(String(body.status)) ? String(body.status) : null;
    const plan = String(body.plan || "");
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 });

    const update: Record<string, unknown> = {};
    if (status) update.status = status;
    if (plan) update.subscriptionPlan = plan;
    if (Object.keys(update).length) {
      await db.update(companies).set(update).where(eq(companies.id, companyId));
      if (plan) {
        const existingSub = await db.select().from(subscriptions).where(eq(subscriptions.companyId, companyId)).limit(1);
        if (existingSub[0]) {
          await db.update(subscriptions).set({ plan, status: "active" }).where(eq(subscriptions.companyId, companyId));
        } else {
          await db.insert(subscriptions).values({ companyId, plan });
        }
      }
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "createCompany") {
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const plan = String(body.plan || "basic");
    if (!name || !email || password.length < 8) {
      return NextResponse.json({ error: "Company name, admin email and password (min 8 chars) are required." }, { status: 400 });
    }
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length) return NextResponse.json({ error: "Email already in use." }, { status: 409 });

    const comp = await db.insert(companies).values({ name, email, subscriptionPlan: plan }).returning();
    await db.insert(companySettings).values({ companyId: comp[0].id });
    await db.insert(subscriptions).values({ companyId: comp[0].id, plan });
    const admin = await db
      .insert(users)
      .values({ companyId: comp[0].id, email, passwordHash: hashPassword(password), fullName: "Administrator", role: "company_admin" })
      .returning();
    await db.insert(employees).values({ companyId: comp[0].id, userId: admin[0].id, designation: "Administrator" });
    return NextResponse.json({ ok: true, id: comp[0].id });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}