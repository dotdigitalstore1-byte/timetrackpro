import { createHash, timingSafeEqual } from "crypto";

/**
 * The platform owner is defined by the environment, not by a database row or a one-time seed.
 * Change SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD and the next sign-in uses the new values.
 */
export interface SuperAdminEnv {
  email: string;
  password: string;
}

// A plain env map (ProcessEnv and test fixtures both satisfy this).
export type SuperAdminEnvSource = Record<string, string | undefined>;

export function readSuperAdminEnv(env: SuperAdminEnvSource = process.env): SuperAdminEnv | null {
  const email = (env.SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = env.SUPER_ADMIN_PASSWORD ?? "";
  return email && password ? { email, password } : null;
}

// Compare fixed-size digests so the check is constant-time regardless of input length.
function secureEqual(a: string, b: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

export function matchesSuperAdminCredentials(
  email: string,
  password: string,
  env: SuperAdminEnvSource = process.env
): boolean {
  const admin = readSuperAdminEnv(env);
  if (!admin) return false;
  return email.trim().toLowerCase() === admin.email && secureEqual(password, admin.password);
}