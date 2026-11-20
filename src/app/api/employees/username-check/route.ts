import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { can, loadAccess } from "@/lib/access";
import { usernameStatus } from "@/lib/username";
import { isRateLimited } from "@/lib/rate-limit";

/** Live check while an admin types a username. Looks across the whole platform, so it is only open to people who can add employees. */
export async function GET(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await loadAccess(ctx);
  if (!can(access, "manage_employees")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Each keystroke is debounced on the client; this cap stops the endpoint being used to scan usernames.
  if (await isRateLimited(`username-check:${ctx.user.id}`, 120, 60)) {
    return NextResponse.json({ error: "Too many checks. Please wait a moment." }, { status: 429 });
  }
  const username = new URL(req.url).searchParams.get("username") ?? "";
  return NextResponse.json(await usernameStatus(username));
}
