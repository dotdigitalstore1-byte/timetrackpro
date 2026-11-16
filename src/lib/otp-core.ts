// Email one-time codes: generation, salted hashing and policy. Pure apart from node's crypto module,
// so it can be tested directly.
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "crypto";

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_SECONDS = 60;

/** A six-digit numeric code with uniform randomness (leading zeros kept). */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function isOtpShaped(code: string): boolean {
  return /^\d{6}$/.test(code);
}

/** Stores `salt:hash`. Only the hash is persisted, never the code. */
export function hashOtp(code: string, salt: string = randomBytes(16).toString("hex")): string {
  return `${salt}:${scryptSync(code, salt, 32).toString("hex")}`;
}

export function verifyOtp(code: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(code, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/**
 * When the code may be written to the server console instead of being emailed.
 * Always allowed in development. In production only when explicitly enabled, because the code is then
 * visible to anyone who can read the logs.
 */
export function otpConsoleFallbackAllowed(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV !== "production" || env.OTP_CONSOLE_FALLBACK === "true";
}

export function otpExpiry(now: Date): Date {
  return new Date(now.getTime() + OTP_TTL_MINUTES * 60_000);
}
