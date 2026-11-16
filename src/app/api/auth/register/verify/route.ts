import { NextResponse } from "next/server";
import { createSession, setSessionCookie } from "@/lib/auth";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { completeRegistration } from "@/lib/registration";

/** Step 2 of sign-up: check the emailed code, then create the company, the 20-day trial and the admin session. */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const code = String(body.code || "").trim();

    if (await isRateLimited(`register:verify:ip:${clientIp(req)}`, 60, 900)) {
      return NextResponse.json({ error: "Too many attempts. Please wait a few minutes." }, { status: 429 });
    }
    if (!email) return NextResponse.json({ error: "Email is required." }, { status: 400 });

    const result = await completeRegistration(email, code);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    const token = await createSession(result.adminId);
    await setSessionCookie(token);
    return NextResponse.json({ ok: true, companyId: result.companyId, name: result.fullName });
  } catch (e) {
    console.error("register verify error", e);
    return NextResponse.json({ error: "Verification failed. Please try again." }, { status: 500 });
  }
}
