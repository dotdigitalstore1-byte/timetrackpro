import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroySession, clearSessionCookie } from "@/lib/auth";

export async function POST() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("att_session")?.value;
    if (token) {
      await destroySession(token);
    }
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch {
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  }
}