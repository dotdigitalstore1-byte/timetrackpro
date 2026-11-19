import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { OnboardingError, updateSpecialist } from "@/lib/onboarding";

/** Edits a specialist: commission override (null = global default), active flag, phone, photo or password reset. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Unknown specialist." }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  try {
    await updateSpecialist(id, body, ctx.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof OnboardingError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("update specialist error", e);
    return NextResponse.json({ error: "Could not update the specialist." }, { status: 500 });
  }
}
