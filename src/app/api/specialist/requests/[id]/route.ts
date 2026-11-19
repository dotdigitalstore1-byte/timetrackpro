import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { claimRequest, completeRequest, flagRequest, OnboardingError, releaseRequest } from "@/lib/onboarding";

const UUID = /^[0-9a-f-]{36}$/i;

/** Specialist actions on one request: claim | release | flag | complete. Each is checked against the request's current state. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "onboarding_specialist") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Unknown request." }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  try {
    if (action === "claim") await claimRequest(ctx.user.id, id);
    else if (action === "release") await releaseRequest(ctx.user.id, id, body.note ? String(body.note) : undefined);
    else if (action === "flag") await flagRequest(ctx.user.id, id, String(body.reason || ""));
    else if (action === "complete") await completeRequest(ctx.user.id, id);
    else return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof OnboardingError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("specialist action error", e);
    return NextResponse.json({ error: "Could not update this request." }, { status: 500 });
  }
}
