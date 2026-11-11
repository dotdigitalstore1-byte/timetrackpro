import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
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

const SESSION_COOKIE = "att_session";
const SESSION_DAYS = 30;

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
}

/**
 * Resolves the signed-in user, company, settings and employee profile in ONE query.
 * Previously this took three sequential round trips per request, which multiplied latency and database
 * connection use during the morning punch-in spike.
 */
export async function getAuth(): Promise<AuthContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

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

  if (!user.companyId) return { user, company: null, settings: null, employee: null, sessionToken: token };

  if (company && company.status !== "active" && user.role !== "super_admin") {
    return null; // suspended / deactivated companies cannot log in
  }
  return {
    user,
    company: company ?? null,
    settings: settings ?? null,
    employee: user.role === "employee" ? employee ?? null : null,
    sessionToken: token,
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
