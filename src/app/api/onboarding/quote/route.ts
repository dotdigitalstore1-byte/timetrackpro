import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { OnboardingError, quoteForCompany } from "@/lib/onboarding";

/** Live price preview for the form. The checkout endpoint prices again on the server; this value is never charged as-is. */
export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx || !ctx.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const count = Number(body.employeeCount ?? 0);
  if (!Number.isInteger(count) || count < 0 || count > 100_000) {
    return NextResponse.json({ error: "Enter a whole number of employees." }, { status: 400 });
  }
  try {
    const quote = await quoteForCompany({
      includeOnboarding: !!body.includeOnboarding,
      includeEmployees: !!body.includeEmployees,
      employeeCount: count,
    });
    return NextResponse.json({ quote });
  } catch (e) {
    if (e instanceof OnboardingError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("onboarding quote error", e);
    return NextResponse.json({ error: "Could not price this request." }, { status: 500 });
  }
}
