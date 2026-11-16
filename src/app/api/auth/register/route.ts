import { NextResponse } from "next/server";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { startRegistration } from "@/lib/registration";
import { OTP_RESEND_SECONDS, OTP_TTL_MINUTES } from "@/lib/otp-core";

/** Step 1 of sign-up: validate the details and email a verification code. The company is not created yet. */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const companyName = String(body.companyName || "").trim();
    const adminName = String(body.adminName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const phone = String(body.phone || "").trim();

    if (await isRateLimited(`register:ip:${clientIp(req)}`, 10, 3600)) {
      return NextResponse.json({ error: "Too many sign-ups from this network. Please try again later." }, { status: 429 });
    }
    if (!companyName || !adminName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 8) {
      return NextResponse.json(
        { error: "Please fill all fields with a valid email and a password of at least 8 characters." },
        { status: 400 }
      );
    }
    // Per address too, so spreading requests across networks cannot keep sending codes to one inbox.
    if (await isRateLimited(`register:email:${email}`, 6, 3600)) {
      return NextResponse.json({ error: "Too many codes requested for this email. Please try again later." }, { status: 429 });
    }

    const result = await startRegistration({
      companyName,
      adminName,
      email,
      phone,
      password,
      timezone: String(body.timezone || ""),
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    return NextResponse.json({
      ok: true,
      email,
      delivery: result.delivery,
      expiresInMinutes: OTP_TTL_MINUTES,
      resendSeconds: OTP_RESEND_SECONDS,
    });
  } catch (e) {
    console.error("register start error", e);
    return NextResponse.json({ error: "Registration failed. Please try again." }, { status: 500 });
  }
}
