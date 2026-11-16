import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { billingCycles, plans } from "@/db/schema";
import { getAuthAllowLocked } from "@/lib/auth";
import { activatePlan, seatsUsed } from "@/lib/billing";
import { canSelfActivate } from "@/lib/billing-core";

/**
 * Activates a plan for the chosen billing length. The plan's seat limit must cover everyone who is
 * currently active. Payment capture is NOT implemented here: see canSelfActivate() and the README.
 */
export async function POST(req: Request) {
  const ctx = await getAuthAllowLocked();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.company) return NextResponse.json({ error: "No company is linked to this account." }, { status: 404 });
  if (ctx.user.role !== "company_admin") {
    return NextResponse.json({ error: "Only the company admin can change the subscription." }, { status: 403 });
  }
  if (!canSelfActivate(process.env)) {
    return NextResponse.json(
      { error: "Online subscriptions are not available yet. Please contact support to activate a plan." },
      { status: 503 }
    );
  }

  const body = await req.json();
  const planId = String(body.planId || "");
  const months = Number(body.months);
  if (!/^[0-9a-f-]{36}$/i.test(planId)) return NextResponse.json({ error: "Choose a plan." }, { status: 400 });

  const [plan] = await db.select().from(plans).where(and(eq(plans.id, planId), eq(plans.isActive, true))).limit(1);
  if (!plan) return NextResponse.json({ error: "That plan is not available." }, { status: 404 });

  const [cycle] = await db
    .select()
    .from(billingCycles)
    .where(and(eq(billingCycles.months, months), eq(billingCycles.isActive, true)))
    .limit(1);
  if (!cycle) return NextResponse.json({ error: "Choose a billing length of 1, 6 or 12 months." }, { status: 400 });

  const headcount = await seatsUsed(ctx.company.id);
  if (plan.employeeLimit < headcount) {
    return NextResponse.json(
      {
        error: `Your company has ${headcount} active people. Choose a plan with at least ${headcount} seats.`,
        code: "SEATS_BELOW_HEADCOUNT",
      },
      { status: 400 }
    );
  }

  const { endDate, amount, quote } = await activatePlan({
    companyId: ctx.company.id,
    plan,
    months: cycle.months,
    discountPercent: Number(cycle.discountPercent),
    actorId: ctx.user.id,
    comped: false,
  });
  return NextResponse.json({ ok: true, endDate: endDate.toISOString(), amount, perMonth: quote.perMonth });
}
