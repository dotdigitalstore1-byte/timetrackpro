import { NextResponse } from "next/server";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { verifyPasswordReset } from "@/lib/password-reset";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const code = String(body.code || "").trim();
    if (await isRateLimited(`reset:verify:ip:${clientIp(req)}`, 60, 900)) {
      return NextResponse.json({ error: "Too many attempts. Please wait a few minutes." }, { status: 429 });
    }
    const result = await verifyPasswordReset(email, code);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, resetToken: result.resetToken });
  } catch (e) {
    console.error("reset verify error", e);
    return NextResponse.json({ error: "Verification failed. Please try again." }, { status: 500 });
  }
}
