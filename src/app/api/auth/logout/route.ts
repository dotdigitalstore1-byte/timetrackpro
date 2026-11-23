import { NextResponse } from "next/server";
import { destroySession, clearSessionCookie, sessionTokenFromRequest } from "@/lib/auth";

export async function POST() {
  try {
    // Works for both the web cookie and the mobile app's bearer token.
    const session = await sessionTokenFromRequest();
    if (session) {
      await destroySession(session.token);
    }
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch {
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  }
}
