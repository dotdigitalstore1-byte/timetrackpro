import { NextResponse } from "next/server";
import { and, count, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { attendance, companies, companySettings, employees, platformEvents, platformSettings, plans, subscriptions, users } from "@/db/schema";
import { getAuth, hashPassword } from "@/lib/auth";
import { activatePlan, startTrialTx } from "@/lib/billing";
import { validateCycleInput, validateGracePolicy, DEFAULT_GRACE_POLICY } from "@/lib/billing-core";
import { generateCompanyCode } from "@/lib/company-code-core";
import { clearGracePolicyCache, loadGracePolicy } from "@/lib/grace-policy";

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
  const gracePolicy = await loadGracePolicy();

  return NextResponse.json({
    stats: {
      totalCompanies: companyRows.length,
      activeCompanies: companyRows.filter((r) => r.company.status === "active").length,
      totalEmployees,
      presentCompaniesToday: presentToday,
    },
    gracePolicy,
    companies: companyRows.map((r) => ({
      id: r.company.id,
      code: r.company.code,
      name: r.company.name,
      email: r.company.email,
      phone: r.company.phone,
      status: r.company.status,
      subscriptionPlan: r.company.subscriptionPlan,
      subscriptionStatus: r.company.subscriptionStatus,
      accessUntil: r.company.accessUntil,
      employeeLimit: r.company.employeeLimit,
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

  if (action === "updateGracePolicy") {
    // Platform-wide: how many days after a paid period ends that history is hidden, punching stops, and access is blocked.
    const checked = validateGracePolicy(body);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
    const before = await loadGracePolicy();
    const values = {
      graceBlurAfterDays: checked.value.blurAfterDays,
      gracePunchUntilDays: checked.value.punchUntilDays,
      graceBlockAfterDays: checked.value.blockAfterDays,
      updatedAt: new Date(),
      updatedBy: ctx.user.id,
    };
    await db.transaction(async (tx) => {
      await tx
        .insert(platformSettings)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({ target: platformSettings.id, set: values });
      await tx.insert(platformEvents).values({
        action: "platform.grace_policy_changed",
        actorId: ctx.user.id,
        details: { before, after: checked.value },
      });
    });
    clearGracePolicyCache();
    return NextResponse.json({ ok: true, gracePolicy: checked.value, defaults: DEFAULT_GRACE_POLICY });
  }

  if (action === "updateCompany") {
    const companyId = String(body.companyId || "");
    const status = ["active", "suspended", "deactivated"].includes(String(body.status)) ? String(body.status) : null;
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    if (status) await db.update(companies).set({ status }).where(eq(companies.id, companyId));
    return NextResponse.json({ ok: true });
  }

  if (action === "grantSubscription") {
    // Platform override: activate any plan for a company at no charge (e.g. a sales deal, or manual invoicing).
    const companyId = String(body.companyId || "");
    const planId = String(body.planId || "");
    if (!/^[0-9a-f-]{36}$/i.test(companyId) || !/^[0-9a-f-]{36}$/i.test(planId)) {
      return NextResponse.json({ error: "Choose a company and a plan." }, { status: 400 });
    }
    const cycle = validateCycleInput({ months: body.months, discountPercent: 0 });
    if (!cycle.ok) return NextResponse.json({ error: cycle.error }, { status: 400 });

    const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });
    const [plan] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
    if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });

    const result = await activatePlan({
      companyId,
      plan,
      months: cycle.value.months,
      discountPercent: 0,
      actorId: ctx.user.id,
      comped: true,
    });
    return NextResponse.json({ ok: true, endDate: result.endDate.toISOString() });
  }

  if (action === "deleteCompany") {
    // Permanently removes the company and everything that belongs to it (employees, attendance, salary, leave,
    // agreements, feedback, logos). A typed confirmation of the exact company name is required.
    const companyId = String(body.companyId || "");
    const confirmName = String(body.confirmName || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(companyId)) return NextResponse.json({ error: "Company not found." }, { status: 404 });
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company) return NextResponse.json({ error: "Company not found." }, { status: 404 });
    if (confirmName !== company.name) {
      return NextResponse.json({ error: `Type the company name exactly ("${company.name}") to confirm the deletion.` }, { status: 400 });
    }

    const [headcount] = await db
      .select({ n: count(employees.id) })
      .from(employees)
      .where(eq(employees.companyId, companyId));

    // Logged first, in the same transaction. platform_events has no foreign key to companies, so it survives.
    await db.transaction(async (tx) => {
      await tx.insert(platformEvents).values({
        action: "company.deleted",
        actorId: ctx.user.id,
        companyId,
        companyName: company.name,
        details: {
          employeeCount: Number(headcount?.n ?? 0),
          subscriptionPlan: company.subscriptionPlan,
          status: company.status,
          createdAt: company.createdAt.toISOString(),
        },
      });
      await tx.delete(companies).where(eq(companies.id, companyId));
    });
    return NextResponse.json({ ok: true, deleted: company.name });
  }

  if (action === "createCompany") {
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!name || !email || password.length < 8) {
      return NextResponse.json({ error: "Company name, admin email and password (min 8 chars) are required." }, { status: 400 });
    }
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length) return NextResponse.json({ error: "Email already in use." }, { status: 409 });

    // Same starting point as self sign-up: a 20-day trial with the trial seat limit.
    const companyId = await db.transaction(async (tx) => {
      const [comp] = await tx.insert(companies).values({ name, email, code: generateCompanyCode() }).returning();
      await tx.insert(companySettings).values({ companyId: comp.id });
      await startTrialTx(tx, comp.id);
      await tx
        .insert(users)
        .values({ companyId: comp.id, email, passwordHash: hashPassword(password), fullName: "Administrator", role: "company_admin" });
      return comp.id;
    });
    return NextResponse.json({ ok: true, id: companyId });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}