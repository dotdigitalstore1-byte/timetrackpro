import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authenticateEnvSuperAdmin, createSession, setSessionCookie, verifyPassword } from "@/lib/auth";
import { clearRateLimit, clientIp, isRateLimited } from "@/lib/rate-limit";
import { entryPathFor, homePathFor } from "@/lib/home";
import { isNativeRequestHeaders } from "@/lib/app-platform-core";

/**
 * Two separate sign-in portals share this one implementation, but they never accept each other's accounts:
 *  - "workspace": company admins, managers, employees and the platform owner. Expert Specialists are refused here.
 *  - "specialist": Expert Specialists only. Every other account gets the same generic error, so the portal does not
 *    reveal which accounts exist or what type they are.
 */
export type SignInPortal = "workspace" | "specialist";

// Constant-ish work for unknown emails so response timing does not reveal which accounts exist.
const DUMMY_HASH = "00".repeat(16) + ":" + "00".repeat(64);
const GENERIC_INVALID = "Invalid email ID / username or password.";

const MOBILE_EMPLOYEES_ONLY =
  "The Dotinout mobile app is for employees only. Company admins, managers, specialists and platform owners sign in on the Dotinout website.";

/**
 * "cookie": the web sign-in sets the session cookie (unchanged behaviour).
 * "token": the native app's sign-in. Always treated as the mobile app (employees only) and returns the session token
 * in the body instead of a cookie. The app keeps it in secure device storage and sends it as a Bearer header.
 */
export type SignInDelivery = "cookie" | "token";

export async function signIn(req: Request, portal: SignInPortal, delivery: SignInDelivery = "cookie"): Promise<NextResponse> {
  const native = delivery === "token" || isNativeRequestHeaders(req.headers.get("user-agent"), req.headers.get("cookie"));
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Employees sign in with their email ID or username; anything containing "@" is treated as an email.
  const identifier = String(body.identifier ?? body.email ?? "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!identifier || !password) {
    return NextResponse.json({ error: "Email ID / username and password are required." }, { status: 400 });
  }

  // Rate limits are separate per portal so one portal cannot lock out the other.
  // 8 attempts / 15 min per identifier, 40 / 15 min per IP.
  const ipKey = `login:${portal}:ip:${clientIp(req)}`;
  const idKey = `login:${portal}:id:${identifier}`;
  if ((await isRateLimited(ipKey, 40, 900)) || (await isRateLimited(idKey, 8, 900))) {
    return NextResponse.json({ error: "Too many sign-in attempts. Please wait 15 minutes and try again." }, { status: 429 });
  }

  try {
    if (portal === "workspace") {
      // The platform owner is authenticated from SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD.
      const superAdmin = await authenticateEnvSuperAdmin(identifier, password);
      if (superAdmin && delivery === "cookie") {
        if (native) return NextResponse.json({ error: MOBILE_EMPLOYEES_ONLY }, { status: 403 });
        await clearRateLimit(idKey);
        const token = await createSession(superAdmin.id);
        await setSessionCookie(token);
        return NextResponse.json({ ok: true, role: "super_admin", home: homePathFor("super_admin") });
      }
    }

    const rows = await db
      .select()
      .from(users)
      .where(identifier.includes("@") ? eq(users.email, identifier) : eq(users.username, identifier))
      .limit(1);
    const user = rows[0];
    const passwordOk = verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);

    if (!user || !passwordOk || !user.isActive) {
      if (user && !user.isActive && passwordOk) {
        return NextResponse.json({ error: "This account has been deactivated." }, { status: 403 });
      }
      return NextResponse.json({ error: GENERIC_INVALID }, { status: 401 });
    }

    // Super admins are owned by the environment; a stored hash must never sign one in.
    if (user.role === "super_admin") {
      return NextResponse.json({ error: GENERIC_INVALID }, { status: 401 });
    }

    // Checked after the password, so only someone who knows the password learns the account type.
    if (native && user.role !== "employee") {
      return NextResponse.json({ error: MOBILE_EMPLOYEES_ONLY }, { status: 403 });
    }

    const isSpecialist = user.role === "onboarding_specialist";
    if (portal === "specialist" && !isSpecialist) {
      // Same response as a wrong password: this portal only exists for Expert Specialists.
      return NextResponse.json({ error: GENERIC_INVALID }, { status: 401 });
    }
    if (portal === "workspace" && isSpecialist) {
      return NextResponse.json(
        { error: "Expert Specialists sign in on the Specialist portal." },
        { status: 403 }
      );
    }

    await clearRateLimit(idKey);
    const token = await createSession(user.id);
    if (delivery === "token") {
      return NextResponse.json({
        ok: true,
        token,
        role: user.role,
        home: entryPathFor({ role: user.role, locked: false, native: true }),
      });
    }
    await setSessionCookie(token);
    // Employees on the web are sent to the "Get the app" page; the mobile app goes straight to their home.
    return NextResponse.json({ ok: true, role: user.role, home: entryPathFor({ role: user.role, locked: false, native }) });
  } catch (e) {
    console.error(`${portal} sign-in error`, e);
    return NextResponse.json({ error: "Login failed. Please try again." }, { status: 500 });
  }
}
