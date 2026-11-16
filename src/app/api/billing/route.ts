import { NextResponse } from "next/server";
import { getAuthAllowLocked } from "@/lib/auth";
import { loadPricing, seatsUsed, serializeCycle, serializePlan } from "@/lib/billing";
import { accessInfo, canSelfActivate, TRIAL_DAYS, TRIAL_EMPLOYEE_LIMIT } from "@/lib/billing-core";
import { activeProvider } from "@/lib/payments";

/** Billing status for the signed-in company. Also works while the company is locked, so people can subscribe. */
export async function GET() {
  const ctx = await getAuthAllowLocked();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.company) return NextResponse.json({ error: "No company is linked to this account." }, { status: 404 });

  const company = ctx.company;
  const access = accessInfo(company, new Date());
  const isAdmin = ctx.user.role === "company_admin";
  const pricing = await loadPricing();

  return NextResponse.json({
    company: { name: company.name, subscriptionPlan: company.subscriptionPlan },
    role: ctx.user.role,
    access,
    seats: isAdmin ? { used: await seatsUsed(company.id), limit: access.employeeLimit } : null,
    plans: pricing.plans.map(serializePlan),
    cycles: pricing.cycles.map(serializeCycle),
    canSelfActivate: canSelfActivate(process.env),
    paymentProvider: activeProvider(),
    razorpayKeyId: activeProvider() === "razorpay" ? process.env.RAZORPAY_KEY_ID ?? null : null,
    trial: { days: TRIAL_DAYS, employeeLimit: TRIAL_EMPLOYEE_LIMIT },
  });
}
