import { NextResponse } from "next/server";
import { createSession, setSessionCookie } from "@/lib/auth";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { completeRegistration } from "@/lib/registration";
import { withTransientRetry } from "@/lib/db-retry";

/** Step 2 of sign-up: check the emailed code, then create the company, the 20-day trial and the admin session. */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }
  const email = String(body.email || "").trim().toLowerCase();
  const code = String(body.code || "").trim();
  if (!email) return NextResponse.json({ error: "Email is required." }, { status: 400 });

  try {
    const outcome = await withTransientRetry(async () => {
      if (await isRateLimited(`register:verify:ip:${clientIp(req)}`, 60, 900)) return { limited: true as const };
      // The creation is one transaction, so a retry after a dropped connection cannot create half a company.
      return { limited: false as const, result: await completeRegistration(email, code) };
    });
    if (outcome.limited) {
      return NextResponse.json({ error: "Too many attempts. Please wait a few minutes." }, { status: 429 });
    }
    const result = outcome.result;
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    const token = await createSession(result.adminId);
    await setSessionCookie(token);
    return NextResponse.json({ ok: true, companyId: result.companyId, name: result.fullName });
  } catch (e) {
    console.error("register verify error", e);
    return NextResponse.json({ error: "We could not verify your code just now. Please try again." }, { status: 503 });
  }
}
