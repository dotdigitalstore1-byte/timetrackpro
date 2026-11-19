import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { OnboardingError, rateRequest } from "@/lib/onboarding";

/** Company admin rates the specialist's work on a 0 to 100 scale once the request is marked complete. */
export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx || !ctx.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const requestId = String(body.requestId || "");
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return NextResponse.json({ error: "Unknown request." }, { status: 400 });
  try {
    await rateRequest(ctx.company.id, requestId, body.satisfaction);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof OnboardingError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("onboarding rate error", e);
    return NextResponse.json({ error: "Could not save your rating." }, { status: 500 });
  }
}
