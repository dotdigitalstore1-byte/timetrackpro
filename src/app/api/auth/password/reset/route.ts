import { NextResponse } from "next/server";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { completePasswordReset } from "@/lib/password-reset";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const token = String(body.resetToken || "");
    const password = String(body.password || "");
    if (await isRateLimited(`reset:complete:ip:${clientIp(req)}`, 30, 900)) {
      return NextResponse.json({ error: "Too many attempts. Please wait a few minutes." }, { status: 429 });
    }
    if (!email || !token) return NextResponse.json({ error: "This reset link is not valid." }, { status: 400 });
    const result = await completePasswordReset(email, token, password);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("reset complete error", e);
    return NextResponse.json({ error: "Could not reset the password. Please try again." }, { status: 500 });
  }
}
