import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Punch challenges. Each punch request must carry a fresh signature made with the signed-in session's token.
 * This stops a stored punch request (photo + GPS) from being replayed later, and makes every punch come from
 * an authenticated request made at that moment. It is NOT proof that a live camera took the photo; that part is
 * enforced in the browser (no file picker) and, for real protection, by the native app (see README).
 */
export const CHALLENGE_MAX_AGE_MS = 3 * 60 * 1000;
const CLOCK_SKEW_MS = 30 * 1000;

export function signChallenge(sessionToken: string, ts: number): string {
  return createHmac("sha256", sessionToken).update(`punch:${ts}`).digest("hex");
}

export function verifyChallenge(sessionToken: string, ts: unknown, sig: unknown, now: number = Date.now()): boolean {
  if (typeof ts !== "number" || !Number.isFinite(ts) || typeof sig !== "string") return false;
  if (now - ts > CHALLENGE_MAX_AGE_MS || ts - now > CLOCK_SKEW_MS) return false;
  const expected = Buffer.from(signChallenge(sessionToken, ts), "hex");
  const given = Buffer.from(sig, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
