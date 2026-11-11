import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { signChallenge } from "@/lib/capture-token";

/** A fresh, session-bound challenge that the next punch request must include. */
export async function GET() {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "employee" || !ctx.employee) {
    return NextResponse.json({ error: "Only employees punch attendance." }, { status: 403 });
  }
  const ts = Date.now();
  return NextResponse.json({ ts, sig: signChallenge(ctx.sessionToken, ts) }, { headers: { "Cache-Control": "no-store" } });
}
