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
    // Employees sign in with their email ID or username; anything containing "@" is treated as an email.
    const identifier = String(body.identifier ?? body.email ?? "").trim().toLowerCase();
    const password = String(body.password || "");
    // "specialist" = the dedicated Expert Specialist sign-in; only specialist accounts may use it.
    const portal = body.portal === "specialist" ? "specialist" : "workspace";

    if (!identifier || !password) {
      return NextResponse.json({ error: "Email ID / username and password are required." }, { status: 400 });
    }
    const email = identifier;

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
      if (portal === "specialist") {
        return NextResponse.json({ error: "This sign-in is for Expert Specialists only." }, { status: 403 });
      }
      await clearRateLimit(emailKey);
      const token = await createSession(superAdmin.id);
      await setSessionCookie(token);
      return NextResponse.json({ ok: true, role: "super_admin" });
    }

    const rows = await db
      .select()
      .from(users)
      .where(email.includes("@") ? eq(users.email, email) : eq(users.username, email))
      .limit(1);
    const user = rows[0];
    const ok = verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !ok) {
      return NextResponse.json({ error: "Invalid email ID / username or password." }, { status: 401 });
    }
    if (!user.isActive) {
      return NextResponse.json({ error: "This account has been deactivated." }, { status: 403 });
    }
    // Super admins are owned by the environment; a stored hash must never sign one in.
    if (user.role === "super_admin") {
      return NextResponse.json({ error: "Invalid email ID / username or password." }, { status: 401 });
    }
    // Checked only after the password is verified, so the account type is never revealed to anyone guessing.
    if (portal === "specialist" && user.role !== "onboarding_specialist") {
      return NextResponse.json({ error: "This sign-in is for Expert Specialists only. Use the main sign-in page." }, { status: 403 });
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
