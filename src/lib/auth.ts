import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies, headers } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import {
  companies,
  companySettings,
  employees,
  sessions,
  users,
} from "@/db/schema";
import type { Company, CompanySettings, Employee, User } from "@/db/schema";
import { matchesSuperAdminCredentials, readSuperAdminEnv } from "@/lib/super-admin";
import { accessInfo } from "@/lib/billing-core";
import { loadGracePolicy } from "@/lib/grace-policy";
import { parseBearerToken } from "@/lib/app-platform-core";

const SESSION_COOKIE = "att_session";
// Mobile users stay signed in. 400 days is the longest cookie lifetime browsers accept; sign-out and password
// resets still revoke sessions immediately.
const SESSION_DAYS = 400;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/**
 * Authenticates the platform owner against SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD.
 * The owner's user row is created or refreshed on demand, so changing the env values takes effect
 * on the next sign-in with no seed step or manual database update.
 */
export async function authenticateEnvSuperAdmin(email: string, password: string): Promise<User | null> {
  const admin = readSuperAdminEnv();
  if (!admin || !matchesSuperAdminCredentials(email, password)) return null;

  const existing = await db.select().from(users).where(eq(users.email, admin.email)).limit(1);
  const row = existing[0];

  // Already consistent with the current env values: no write needed.
  if (
    row &&
    row.role === "super_admin" &&
    row.isActive &&
    row.companyId === null &&
    verifyPassword(admin.password, row.passwordHash)
  ) {
    return row;
  }

  const values = {
    passwordHash: hashPassword(admin.password),
    fullName: "Super Admin",
    role: "super_admin" as const,
    companyId: null,
    isActive: true,
  };

  if (row) {
    const updated = await db.update(users).set(values).where(eq(users.id, row.id)).returning();
    // The account's credentials/role changed from the environment: drop sessions issued under the old state.
    await db.delete(sessions).where(eq(sessions.userId, row.id));
    return updated[0] ?? null;
  }

  const inserted = await db
    .insert(users)
    .values({ email: admin.email, ...values })
    .returning();
  return inserted[0] ?? null;
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ userId, token, expiresAt });
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token));
}

export interface AuthContext {
  user: User;
  company: Company | null;
  settings: CompanySettings | null;
  employee: Employee | null;
  /** The raw session token. Used to sign short-lived punch challenges (see capture-token.ts). Never sent to clients. */
  sessionToken: string;
  /** True when the session came from an Authorization bearer token (the native app), not the web cookie. */
  viaBearer: boolean;
  /** The company admin is locked out (trial or paid period ended). Only the billing pages may be used then. */
  locked: boolean;
  /** Employees and managers are locked out (trial ended, or the 30-day hard cutoff). */
  staffLocked: boolean;
  /** Employee personal history is hidden (5 to 29 days after a paid expiry). Punching still works. */
  restricted: boolean;
}

/**
 * The signed-in session, including companies whose access has lapsed (`locked`).
 * Use this only for the billing page and the layout redirect. Every other route calls getAuth().
 */
export async function getAuthAllowLocked(): Promise<AuthContext | null> {
  return resolveAuth();
}

/**
 * The signed-in user for normal work. Returns null for a locked company, so every API route
 * refuses access (including historical data) until the company subscribes.
 */
export async function getAuth(): Promise<AuthContext | null> {
  const ctx = await resolveAuth();
  if (!ctx) return null;
  // Admins are locked as soon as the company's period ends. Staff keep working through the grace window.
  const blocked = ctx.user.role === "company_admin" ? ctx.locked : ctx.staffLocked;
  return blocked ? null : ctx;
}

/**
 * Resolves the signed-in user, company, settings and employee profile in ONE query.
 * Previously this took three sequential round trips per request, which multiplied latency and database
 * connection use during the morning punch-in spike.
 */
/**
 * The session token for this request: an Authorization bearer token when present (mobile app), otherwise the web
 * cookie. Browsers never send bearer headers on their own, so bearer requests are not affected by CSRF.
 */
export async function sessionTokenFromRequest(): Promise<{ token: string; viaBearer: boolean } | null> {
  const h = await headers();
  const bearer = parseBearerToken(h.get("authorization"));
  if (bearer) return { token: bearer, viaBearer: true };
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return token ? { token, viaBearer: false } : null;
}

async function resolveAuth(): Promise<AuthContext | null> {
  const session = await sessionTokenFromRequest();
  if (!session) return null;
  const { token, viaBearer } = session;

  const rows = await db
    .select({
      user: users,
      company: companies,
      settings: companySettings,
      employee: employees,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .leftJoin(companies, eq(companies.id, users.companyId))
    .leftJoin(companySettings, eq(companySettings.companyId, users.companyId))
    // Only employee accounts have an employee profile (punching, leave, salary). Admins and managers supervise.
    .leftJoin(employees, and(eq(employees.userId, users.id), eq(users.role, "employee")))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  const { user, company, settings, employee } = row;
  if (!user.isActive) return null;

  // The platform owner is defined by the environment. If SUPER_ADMIN_EMAIL changes, sessions for
  // the previous owner email stop being valid on their next request.
  if (user.role === "super_admin") {
    const owner = readSuperAdminEnv();
    if (!owner || user.email.trim().toLowerCase() !== owner.email) return null;
  }

  if (!user.companyId) {
    return { user, company: null, settings: null, employee: null, sessionToken: token, viaBearer, locked: false, staffLocked: false, restricted: false };
  }

  if (company && company.status !== "active" && user.role !== "super_admin") {
    return null; // suspended / deactivated companies cannot log in
  }
  const info = company ? accessInfo(company, new Date(), await loadGracePolicy()) : null;
  return {
    user,
    company: company ?? null,
    settings: settings ?? null,
    employee: user.role === "employee" ? employee ?? null : null,
    sessionToken: token,
    viaBearer,
    locked: info?.locked ?? false,
    staffLocked: info?.staffLocked ?? false,
    restricted: user.role === "employee" && (info?.restricted ?? false),
  };
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
