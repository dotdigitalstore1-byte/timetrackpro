import { NextResponse } from "next/server";
import { handleRazorpayWebhook } from "@/lib/payments";

/** Server-to-server notifications from Razorpay. No session: the signature is the authentication. */
export async function POST(req: Request) {
  const raw = await req.text();
  try {
    const ok = await handleRazorpayWebhook(raw, req.headers.get("x-razorpay-signature") ?? "");
    if (!ok) return NextResponse.json({ error: "invalid signature" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("razorpay webhook error", e);
    return NextResponse.json({ error: "processing failed" }, { status: 500 }); // the gateway retries
  }
}
