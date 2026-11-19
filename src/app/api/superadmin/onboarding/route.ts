import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { listSpecialists, loadSettings, loadTiers, monitorRequests, monthlyPayouts, OnboardingError, replaceTiers, updateSettings } from "@/lib/onboarding";

const MONTH = /^\d{4}-\d{2}$/;

async function requirePlatformOwner() {
  const ctx = await getAuth();
  if (!ctx) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (ctx.user.role !== "super_admin") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { ctx };
}

/** Everything the Superadmin needs: pricing, specialists, request monitoring and the monthly payout split. */
export async function GET(req: Request) {
  const auth = await requirePlatformOwner();
  if (auth.error) return auth.error;
  const url = new URL(req.url);
  const now = new Date();
  const fallback = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const month = MONTH.test(url.searchParams.get("month") ?? "") ? (url.searchParams.get("month") as string) : fallback;
  try {
    const [settings, tiers, specialists, monitor, payouts] = await Promise.all([
      loadSettings(),
      loadTiers(),
      listSpecialists(),
      monitorRequests(),
      monthlyPayouts(month),
    ]);
    return NextResponse.json({ settings, tiers, specialists, monitor, payouts, month });
  } catch (e) {
    if (e instanceof OnboardingError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("superadmin onboarding error", e);
    return NextResponse.json({ error: "Could not load Expert Onboarding." }, { status: 500 });
  }
}

/** Saves the base fee and default commission (`settings`) and/or the employee slabs (`tiers`). */
export async function PUT(req: Request) {
  const auth = await requirePlatformOwner();
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({}));
  try {
    if (body.settings) await updateSettings(body.settings, auth.ctx!.user.id);
    if (Array.isArray(body.tiers)) await replaceTiers(body.tiers);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof OnboardingError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("superadmin onboarding save error", e);
    return NextResponse.json({ error: "Could not save the pricing." }, { status: 500 });
  }
}
