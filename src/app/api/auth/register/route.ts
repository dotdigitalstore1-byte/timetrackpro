import { NextResponse } from "next/server";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { startRegistration } from "@/lib/registration";
import { OTP_RESEND_SECONDS, OTP_TTL_MINUTES } from "@/lib/otp-core";
import { withTransientRetry } from "@/lib/db-retry";

/** Step 1 of sign-up: validate the details and email a verification code. The company is not created yet. */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Please fill all fields with a valid email and a password of at least 8 characters." }, { status: 400 });
  }
  const companyName = String(body.companyName || "").trim();
  const adminName = String(body.adminName || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const phone = String(body.phone || "").trim();

  if (!companyName || !adminName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 8) {
    return NextResponse.json(
      { error: "Please fill all fields with a valid email and a password of at least 8 characters." },
      { status: 400 }
    );
  }

  try {
    // The whole step is retried on a dropped connection, so the first click works even right after the database wakes up.
    const outcome = await withTransientRetry(async () => {
      if (await isRateLimited(`register:ip:${clientIp(req)}`, 10, 3600)) {
        return { limited: "ip" as const };
      }
      // Per address too, so spreading requests across networks cannot keep sending codes to one inbox.
      if (await isRateLimited(`register:email:${email}`, 6, 3600)) {
        return { limited: "email" as const };
      }
      return {
        limited: null,
        result: await startRegistration({
          companyName,
          adminName,
          email,
          phone,
          password,
          timezone: String(body.timezone || ""),
        }),
      };
    });

    if (outcome.limited === "ip") {
      return NextResponse.json({ error: "Too many sign-ups from this network. Please try again later." }, { status: 429 });
    }
    if (outcome.limited === "email") {
      return NextResponse.json({ error: "Too many codes requested for this email. Please try again later." }, { status: 429 });
    }
    const result = outcome.result!;
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
    return NextResponse.json(
      { error: "We could not start your sign-up just now. Please try again in a moment." },
      { status: 503 }
    );
  }
}
