import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { confirmOnboardingPayment, OnboardingError } from "@/lib/onboarding";

/** Browser-side confirmation after Razorpay checkout. The gateway is queried again before the request is queued. */
export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx || !ctx.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  try {
    const status = await confirmOnboardingPayment({
      companyId: ctx.company.id,
      orderId: String(body.orderId || ""),
      paymentId: String(body.paymentId || ""),
      signature: String(body.signature || ""),
    });
    return NextResponse.json({ ok: true, status });
  } catch (e) {
    if (e instanceof OnboardingError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("onboarding confirm error", e);
    return NextResponse.json({ error: "Could not confirm the payment. If money was taken, it will be applied automatically." }, { status: 500 });
  }
}
