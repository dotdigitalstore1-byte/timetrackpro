import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { createSpecialist, OnboardingError } from "@/lib/onboarding";

/** Creates an Onboarding Specialist: email, password, phone, optional photo and an optional commission override. */
export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  try {
    const id = await createSpecialist({
      fullName: String(body.fullName ?? ""),
      email: String(body.email ?? ""),
      password: String(body.password ?? ""),
      phone: String(body.phone ?? ""),
      photoDataUrl: body.photoDataUrl ?? null,
      commissionPercent: body.commissionPercent ?? null,
    });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    if (e instanceof OnboardingError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("create specialist error", e);
    return NextResponse.json({ error: "Could not create the specialist." }, { status: 500 });
  }
}
