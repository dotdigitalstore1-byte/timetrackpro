// Server-side billing: pricing catalogue, seat counting, trial start and plan activation.
// Pure rules live in billing-core.ts; this file only talks to the database.
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { billingCycles, companies, platformEvents, plans, subscriptions, users } from "@/db/schema";
import type { BillingCycle, Plan } from "@/db/schema";
import {
  DEFAULT_CYCLES,
  DEFAULT_PLANS,
  DAY_MS,
  PLATFORM_FEATURES,
  TRIAL_DAYS,
  TRIAL_EMPLOYEE_LIMIT,
  addMonths,
  quoteCycle,
  seatCheck,
} from "@/lib/billing-core";

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Seeds the launch price list the first time the platform is used (fresh installs run `db:push`, not the SQL migration). */
export async function ensureDefaultPricing(): Promise<void> {
  const [planRow] = await db.select({ value: count() }).from(plans);
  if (Number(planRow?.value ?? 0) === 0) {
    await db
      .insert(plans)
      .values(
        DEFAULT_PLANS.map((p, i) => ({
          name: p.name,
          employeeLimit: p.employeeLimit,
          price: String(p.price),
          features: PLATFORM_FEATURES,
          sortOrder: i,
        }))
      )
      .onConflictDoNothing();
  }
  const [cycleRow] = await db.select({ value: count() }).from(billingCycles);
  if (Number(cycleRow?.value ?? 0) === 0) {
    await db
      .insert(billingCycles)
      .values(DEFAULT_CYCLES.map((c, i) => ({ months: c.months, label: c.label, discountPercent: String(c.discountPercent), sortOrder: i })))
      .onConflictDoNothing();
  }
}

export function serializePlan(p: Plan) {
  return {
    id: p.id,
    name: p.name,
    employeeLimit: p.employeeLimit,
    price: Number(p.price),
    compareAtPrice: p.compareAtPrice === null ? null : Number(p.compareAtPrice),
    features: p.features,
    isActive: p.isActive,
    sortOrder: p.sortOrder,
  };
}

export function serializeCycle(c: BillingCycle) {
  return {
    id: c.id,
    months: c.months,
    label: c.label,
    discountPercent: Number(c.discountPercent),
    isActive: c.isActive,
  };
}

export async function loadPricing(includeInactive = false) {
  await ensureDefaultPricing();
  const planRows = await db
    .select()
    .from(plans)
    .where(includeInactive ? undefined : eq(plans.isActive, true))
    .orderBy(asc(plans.sortOrder), asc(plans.employeeLimit));
  const cycleRows = await db
    .select()
    .from(billingCycles)
    .where(includeInactive ? undefined : eq(billingCycles.isActive, true))
    .orderBy(asc(billingCycles.months));
  return { plans: planRows, cycles: cycleRows };
}

/** Active people in the company: employee and manager accounts that are switched on. The company admin does not use a seat. */
export async function seatsUsed(companyId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.isActive, true), inArray(users.role, ["employee", "manager"])));
  return Number(row?.value ?? 0);
}

/**
 * Null when `adding` more people fit inside the company's seat limit. Otherwise the message to show.
 * Unlimited (legacy) companies always pass.
 */
export async function seatBlock(
  company: { id: string; employeeLimit: number | null; subscriptionStatus: string },
  adding: number
): Promise<string | null> {
  if (company.employeeLimit === null) return null;
  const used = await seatsUsed(company.id);
  const check = seatCheck(company.employeeLimit, used, adding);
  if (check.ok) return null;
  const limit = company.employeeLimit;
  if (company.subscriptionStatus === "trial") {
    return `Your free trial includes up to ${limit} people (managers included), and all ${limit} seats are in use. Choose a plan to add more.`;
  }
  return `Your plan includes ${limit} seats and all of them are in use. Upgrade your plan to add more people.`;
}

/** Starts the free trial inside an existing transaction: a trial subscription row plus the company's access window. */
export async function startTrialTx(tx: DbTx, companyId: string, now: Date = new Date()): Promise<Date> {
  const endDate = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
  await tx.insert(subscriptions).values({
    companyId,
    plan: "trial",
    amount: "0",
    status: "trial",
    employeeLimit: TRIAL_EMPLOYEE_LIMIT,
    startDate: now,
    endDate,
  });
  await tx
    .update(companies)
    .set({
      subscriptionPlan: "trial",
      subscriptionStatus: "trial",
      accessUntil: endDate,
      employeeLimit: TRIAL_EMPLOYEE_LIMIT,
    })
    .where(eq(companies.id, companyId));
  return endDate;
}

/**
 * Activates a plan for `months`, replacing any trial or earlier paid period. A new period starts now
 * (no proration). `comped` records a platform-granted period at no charge.
 */
export async function activatePlan(opts: {
  companyId: string;
  plan: Plan;
  months: number;
  discountPercent: number;
  actorId: string | null;
  comped: boolean;
  now?: Date;
}) {
  const now = opts.now ?? new Date();
  const { plan, months } = opts;
  const quote = quoteCycle(
    { price: Number(plan.price), compareAtPrice: plan.compareAtPrice === null ? null : Number(plan.compareAtPrice) },
    months,
    opts.discountPercent
  );
  const amount = opts.comped ? 0 : quote.total;
  const endDate = addMonths(now, months);

  return db.transaction(async (tx) => {
    const [company] = await tx.select({ name: companies.name }).from(companies).where(eq(companies.id, opts.companyId)).limit(1);
    await tx
      .update(subscriptions)
      .set({ status: "replaced" })
      .where(and(eq(subscriptions.companyId, opts.companyId), inArray(subscriptions.status, ["trial", "active"])));
    await tx.insert(subscriptions).values({
      companyId: opts.companyId,
      plan: plan.name,
      planId: plan.id,
      amount: String(amount),
      status: "active",
      employeeLimit: plan.employeeLimit,
      billingMonths: months,
      startDate: now,
      endDate,
    });
    await tx
      .update(companies)
      .set({
        subscriptionPlan: plan.name,
        subscriptionStatus: "active",
        accessUntil: endDate,
        employeeLimit: plan.employeeLimit,
      })
      .where(eq(companies.id, opts.companyId));
    await tx.insert(platformEvents).values({
      action: opts.comped ? "subscription.granted" : "subscription.started",
      actorId: opts.actorId,
      companyId: opts.companyId,
      companyName: company?.name ?? null,
      details: { plan: plan.name, employeeLimit: plan.employeeLimit, months, amount, endDate: endDate.toISOString() },
    });
    return { endDate, amount, quote };
  });
}
