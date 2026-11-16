import { NextResponse } from "next/server";
import { getAuthAllowLocked } from "@/lib/auth";
import { createCheckout, PaymentError } from "@/lib/payments";

/** Starts a gateway checkout for the chosen plan. The price is computed here, never taken from the browser. */
export async function POST(req: Request) {
  const ctx = await getAuthAllowLocked();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.company) return NextResponse.json({ error: "No company is linked to this account." }, { status: 404 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Only the company admin can pay for the subscription." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const planId = String(body.planId || "");
  const months = Number(body.months);
  if (!/^[0-9a-f-]{36}$/i.test(planId) || !Number.isInteger(months)) {
    return NextResponse.json({ error: "Choose a plan and a billing length." }, { status: 400 });
  }
  try {
    const checkout = await createCheckout({ companyId: ctx.company.id, userId: ctx.user.id, planId, months });
    return NextResponse.json(checkout);
  } catch (e) {
    if (e instanceof PaymentError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("checkout error", e);
    return NextResponse.json({ error: "Could not start the payment. Please try again." }, { status: 500 });
  }
}
