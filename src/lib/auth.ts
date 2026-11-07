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
}

export async function getAuth(): Promise<AuthContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (rows.length === 0) return null;

  const { user } = rows[0];
  if (!user.isActive) return null;

  if (!user.companyId) return { user, company: null, settings: null, employee: null };

  // These three lookups are independent, so run them together (one round-trip instead of three).
  const [comp, sets, emp] = await Promise.all([
    db.select().from(companies).where(eq(companies.id, user.companyId)).limit(1),
    db.select().from(companySettings).where(eq(companySettings.companyId, user.companyId)).limit(1),
    // Only employee accounts have an employee profile (punching, leave, salary). Admins and managers supervise.
    user.role !== "employee"
      ? Promise.resolve([] as Employee[])
      : db.select().from(employees).where(eq(employees.userId, user.id)).limit(1),
  ]);

  const company: Company | null = comp[0] ?? null;
  if (company && company.status !== "active" && user.role !== "super_admin") {
    return null; // suspended / deactivated companies cannot log in
  }
  const settings: CompanySettings | null = sets[0] ?? null;
  const employee: Employee | null = emp[0] ?? null;

  return { user, company, settings, employee };
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
