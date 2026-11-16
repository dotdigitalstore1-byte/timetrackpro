import { NextResponse } from "next/server";
import { handleCashfreeWebhook } from "@/lib/payments";

export async function POST(req: Request) {
  const raw = await req.text();
  try {
    const ok = await handleCashfreeWebhook(raw, req.headers.get("x-webhook-timestamp") ?? "", req.headers.get("x-webhook-signature") ?? "");
    if (!ok) return NextResponse.json({ error: "invalid signature" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("cashfree webhook error", e);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
