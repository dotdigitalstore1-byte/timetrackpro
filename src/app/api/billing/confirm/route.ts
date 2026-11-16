import { NextResponse } from "next/server";
import { getAuthAllowLocked } from "@/lib/auth";
import { confirmCheckout, PaymentError, type Provider } from "@/lib/payments";

/** Browser-side confirmation after checkout. The gateway is queried again before anything is activated. */
export async function POST(req: Request) {
  const ctx = await getAuthAllowLocked();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.company) return NextResponse.json({ error: "No company is linked to this account." }, { status: 404 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Only the company admin can confirm a payment." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const provider = String(body.provider || "") as Provider;
  if (provider !== "razorpay" && provider !== "cashfree") return NextResponse.json({ error: "Unknown payment provider." }, { status: 400 });
  try {
    const status = await confirmCheckout({
      companyId: ctx.company.id,
      provider,
      orderId: String(body.orderId || ""),
      paymentId: body.paymentId ? String(body.paymentId) : undefined,
      signature: body.signature ? String(body.signature) : undefined,
    });
    return NextResponse.json({ ok: true, status });
  } catch (e) {
    if (e instanceof PaymentError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("confirm error", e);
    return NextResponse.json({ error: "Could not confirm the payment. If money was taken, it will be applied automatically." }, { status: 500 });
  }
}
