import { NextResponse } from "next/server";
import { and, count, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { billingCycles, platformEvents, plans, subscriptions } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { ensureDefaultPricing, serializeCycle, serializePlan } from "@/lib/billing";
import { validateCycleInput, validatePlanInput } from "@/lib/billing-core";

const UUID = /^[0-9a-f-]{36}$/i;

async function requirePlatformOwner() {
  const ctx = await getAuth();
  if (!ctx) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (ctx.user.role !== "super_admin") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { ctx };
}

/** The plan builder: every plan (active or not) with how many subscriptions use it, plus the billing lengths. */
export async function GET() {
  const auth = await requirePlatformOwner();
  if (auth.error) return auth.error;
  await ensureDefaultPricing();

  const planRows = await db.select().from(plans).orderBy(plans.sortOrder, plans.employeeLimit);
  const usage = await db
    .select({ planId: subscriptions.planId, n: count() })
    .from(subscriptions)
    .where(and(eq(subscriptions.status, "active")))
    .groupBy(subscriptions.planId);
  const activeBy = new Map(usage.map((u) => [u.planId, Number(u.n)]));
  const cycleRows = await db.select().from(billingCycles).orderBy(billingCycles.months);

  return NextResponse.json({
    plans: planRows.map((p) => ({ ...serializePlan(p), activeSubscriptions: activeBy.get(p.id) ?? 0 })),
    cycles: cycleRows.map(serializeCycle),
  });
}

export async function POST(req: Request) {
  const auth = await requirePlatformOwner();
  if (auth.error) return auth.error;
  const actorId = auth.ctx!.user.id;

  const body = await req.json();
  const action = String(body.action || "");

  if (action === "create" || action === "update") {
    const parsed = validatePlanInput(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const v = parsed.value;
    const values = {
      name: v.name,
      employeeLimit: v.employeeLimit,
      price: String(v.price),
      compareAtPrice: v.compareAtPrice === null ? null : String(v.compareAtPrice),
      features: v.features,
      isActive: v.isActive,
      sortOrder: v.sortOrder,
      updatedAt: new Date(),
    };
    const duplicate = (excludeId?: string) =>
      db
        .select({ id: plans.id })
        .from(plans)
        .where(excludeId ? and(eq(plans.employeeLimit, v.employeeLimit), ne(plans.id, excludeId)) : eq(plans.employeeLimit, v.employeeLimit))
        .limit(1);

    try {
      if (action === "create") {
        if ((await duplicate()).length) {
          return NextResponse.json({ error: `A plan for ${v.employeeLimit} employees already exists. Edit that plan instead.` }, { status: 409 });
        }
        const [row] = await db.insert(plans).values(values).returning();
        await db.insert(platformEvents).values({ action: "plan.created", actorId, details: { name: row.name, employeeLimit: row.employeeLimit, price: v.price } });
        return NextResponse.json({ ok: true, id: row.id });
      }

      const id = String(body.id || "");
      if (!UUID.test(id)) return NextResponse.json({ error: "Plan not found." }, { status: 404 });
      const [current] = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
      if (!current) return NextResponse.json({ error: "Plan not found." }, { status: 404 });
      if ((await duplicate(id)).length) {
        return NextResponse.json({ error: `Another plan already covers ${v.employeeLimit} employees.` }, { status: 409 });
      }
      await db.update(plans).set(values).where(eq(plans.id, id));
      await db.insert(platformEvents).values({
        action: "plan.updated",
        actorId,
        details: { name: v.name, employeeLimit: v.employeeLimit, price: v.price, previousPrice: Number(current.price) },
      });
      return NextResponse.json({ ok: true });
    } catch (e) {
      if ((e as { code?: string }).code === "23505") {
        return NextResponse.json({ error: "Another plan already covers that many employees." }, { status: 409 });
      }
      throw e;
    }
  }

  if (action === "delete") {
    const id = String(body.id || "");
    if (!UUID.test(id)) return NextResponse.json({ error: "Plan not found." }, { status: 404 });
    const [used] = await db.select({ value: count() }).from(subscriptions).where(eq(subscriptions.planId, id));
    if (Number(used?.value ?? 0) > 0) {
      return NextResponse.json(
        { error: "Companies have subscribed to this plan, so it cannot be deleted. Deactivate it instead." },
        { status: 409 }
      );
    }
    await db.delete(plans).where(eq(plans.id, id));
    return NextResponse.json({ ok: true });
  }

  if (action === "saveCycles") {
    const list = Array.isArray(body.cycles) ? body.cycles : [];
    if (list.length === 0) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
    const parsed = list.map((c: Record<string, unknown>) => validateCycleInput(c));
    const bad = parsed.find((p: { ok: boolean }) => !p.ok);
    if (bad && !bad.ok) return NextResponse.json({ error: bad.error }, { status: 400 });
    const seen = new Set<number>();
    for (const p of parsed) {
      if (p.ok) {
        if (seen.has(p.value.months)) return NextResponse.json({ error: `${p.value.months} months is listed twice.` }, { status: 400 });
        seen.add(p.value.months);
      }
    }
    await db.transaction(async (tx) => {
      for (const p of parsed) {
        if (!p.ok) continue;
        const v = p.value;
        await tx
          .insert(billingCycles)
          .values({ months: v.months, label: v.label, discountPercent: String(v.discountPercent), isActive: v.isActive })
          .onConflictDoUpdate({
            target: billingCycles.months,
            set: { label: v.label, discountPercent: String(v.discountPercent), isActive: v.isActive },
          });
      }
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
