import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { createOnboardingOrder, OnboardingError } from "@/lib/onboarding";

/** Starts a paid Expert Onboarding request. Price and contact validation happen here; the browser's totals are ignored. */
export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx || !ctx.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Only the company admin can request Expert Onboarding." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  try {
    const order = await createOnboardingOrder({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      includeOnboarding: !!body.includeOnboarding,
      includeEmployees: !!body.includeEmployees,
      employeeCount: Number(body.employeeCount ?? 0),
      contact: {
        contactName: String(body.contactName ?? ""),
        setupRequirements: String(body.setupRequirements ?? ""),
        whatsapp: String(body.whatsapp ?? ""),
        email: String(body.email ?? ""),
        call: String(body.call ?? ""),
        callSameAsWhatsapp: !!body.callSameAsWhatsapp,
      },
    });
    return NextResponse.json(order);
  } catch (e) {
    if (e instanceof OnboardingError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("onboarding checkout error", e);
    return NextResponse.json({ error: "Could not start the payment. Please try again." }, { status: 500 });
  }
}
