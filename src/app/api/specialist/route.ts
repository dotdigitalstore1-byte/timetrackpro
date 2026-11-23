import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { requireRoles } from "@/lib/rbac";
import { OnboardingError, specialistQueue } from "@/lib/onboarding";
import { db } from "@/db";
import { onboardingSpecialists } from "@/db/schema";
import { eq } from "drizzle-orm";

/** The Onboarding Specialist's shared queue, their claimed work, completed history and monthly earnings. */
export async function GET() {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = requireRoles(ctx, ["onboarding_specialist"]);
  if (denied) return denied;
  try {
    const [profile] = await db.select().from(onboardingSpecialists).where(eq(onboardingSpecialists.userId, ctx.user.id)).limit(1);
    const queue = await specialistQueue(ctx.user.id);
    return NextResponse.json({
      me: { id: ctx.user.id, name: ctx.user.fullName, email: ctx.user.email, phone: profile?.phone ?? "", photoDataUrl: profile?.photoDataUrl ?? null },
      ...queue,
    });
  } catch (e) {
    if (e instanceof OnboardingError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("specialist queue error", e);
    return NextResponse.json({ error: "Could not load the queue." }, { status: 500 });
  }
}
