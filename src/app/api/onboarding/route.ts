import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { companyRequests, onboardingPaymentsEnabled, priceList } from "@/lib/onboarding";

/** Company admin: current prices (from the Superadmin configuration), the company's requests and whether payment is live. */
export async function GET() {
  const ctx = await getAuth();
  if (!ctx || !ctx.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Only the company admin can request Expert Onboarding." }, { status: 403 });
  const [prices, requests] = await Promise.all([priceList(), companyRequests(ctx.company.id)]);
  return NextResponse.json({
    prices,
    requests,
    paymentsEnabled: onboardingPaymentsEnabled(),
    contactDefaults: { email: ctx.user.email, whatsapp: ctx.user.phone ?? "" },
  });
}
