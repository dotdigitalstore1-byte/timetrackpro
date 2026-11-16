import { NextResponse } from "next/server";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { OTP_RESEND_SECONDS, OTP_TTL_MINUTES } from "@/lib/otp-core";
import { requestPasswordReset } from "@/lib/password-reset";

/** Always answers the same way, so the response never reveals whether an account exists. */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    if (await isRateLimited(`reset:ip:${clientIp(req)}`, 20, 3600)) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
    }
    if (await isRateLimited(`reset:email:${email}`, 5, 3600)) {
      return NextResponse.json({ error: "Too many codes requested for this email. Please try again later." }, { status: 429 });
    }
    await requestPasswordReset(email);
    return NextResponse.json({
      ok: true,
      email,
      message: "If an account exists for this email, a code is on its way.",
      expiresInMinutes: OTP_TTL_MINUTES,
      resendSeconds: OTP_RESEND_SECONDS,
    });
  } catch (e) {
    console.error("forgot password error", e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
