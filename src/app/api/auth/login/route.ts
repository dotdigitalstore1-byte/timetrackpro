import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authenticateEnvSuperAdmin, createSession, setSessionCookie, verifyPassword } from "@/lib/auth";
import { clearRateLimit, clientIp, isRateLimited } from "@/lib/rate-limit";

// Constant-ish work for unknown emails so response timing does not reveal which accounts exist.
const DUMMY_HASH = "00".repeat(16) + ":" + "00".repeat(64);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    // 8 attempts / 15 min per email, 40 / 15 min per IP
    const ipKey = `login:ip:${clientIp(req)}`;
    const emailKey = `login:email:${email}`;
    if ((await isRateLimited(ipKey, 40, 900)) || (await isRateLimited(emailKey, 8, 900))) {
      return NextResponse.json({ error: "Too many sign-in attempts. Please wait 15 minutes and try again." }, { status: 429 });
    }

    // The platform owner is authenticated from SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD and the
    // matching user row is created or refreshed automatically.
    const superAdmin = await authenticateEnvSuperAdmin(email, password);
    if (superAdmin) {
      await clearRateLimit(emailKey);
      const token = await createSession(superAdmin.id);
      await setSessionCookie(token);
      return NextResponse.json({ ok: true, role: "super_admin" });
    }

    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = rows[0];
    const ok = verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !ok) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }
    if (!user.isActive) {
      return NextResponse.json({ error: "This account has been deactivated." }, { status: 403 });
    }
    // Super admins are owned by the environment; a stored hash must never sign one in.
    if (user.role === "super_admin") {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    await clearRateLimit(emailKey);
    const token = await createSession(user.id);
    await setSessionCookie(token);
    return NextResponse.json({ ok: true, role: user.role });
  } catch (e) {
    console.error("login error", e);
    return NextResponse.json({ error: "Login failed. Please try again." }, { status: 500 });
  }
}
