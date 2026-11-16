// Forgot-password flow: email a code, verify it, then set a new password. Responses never reveal whether an
// account exists for an address.
import { createHash, randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { passwordResets, sessions, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { deliverOtp } from "@/lib/mailer";
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_SECONDS,
  generateOtp,
  hashOtp,
  isOtpShaped,
  otpExpiry,
  verifyOtp,
} from "@/lib/otp-core";

export const RESET_TOKEN_MINUTES = 15;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export async function requestPasswordReset(email: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  // The platform owner's password comes from the environment, so it cannot be reset here.
  if (!user || !user.isActive || user.role === "super_admin") return;

  const now = new Date();
  const [row] = await db.select().from(passwordResets).where(eq(passwordResets.email, email)).limit(1);
  if (row && now.getTime() - row.lastSentAt.getTime() < OTP_RESEND_SECONDS * 1000) return; // cooldown, silently

  const code = generateOtp();
  const values = {
    email,
    codeHash: hashOtp(code),
    attempts: 0,
    expiresAt: otpExpiry(now),
    lastSentAt: now,
    resetTokenHash: null,
    resetTokenExpiresAt: null,
  };
  await db.insert(passwordResets).values(values).onConflictDoUpdate({ target: passwordResets.email, set: values });
  try {
    await deliverOtp(email, code, user.fullName, "reset");
  } catch (e) {
    console.error("password reset email failed", e);
    await db.delete(passwordResets).where(eq(passwordResets.email, email));
  }
}

export type ResetStep<T extends object = object> = ({ ok: true } & T) | { ok: false; status: number; error: string };

export async function verifyPasswordReset(email: string, code: string): Promise<ResetStep<{ resetToken: string }>> {
  const invalid = { ok: false as const, status: 400, error: "That code is not valid. Request a new one." };
  if (!isOtpShaped(code)) return { ok: false, status: 400, error: "Enter the 6-digit code from your email." };
  const [row] = await db.select().from(passwordResets).where(eq(passwordResets.email, email)).limit(1);
  if (!row) return invalid;
  const now = new Date();
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, status: 400, error: "This code has expired. Request a new one." };
  if (row.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, status: 429, error: "Too many incorrect attempts. Request a new code." };
  if (!verifyOtp(code, row.codeHash)) {
    const attempts = row.attempts + 1;
    await db.update(passwordResets).set({ attempts }).where(eq(passwordResets.email, email));
    const left = OTP_MAX_ATTEMPTS - attempts;
    return { ok: false, status: left > 0 ? 400 : 429, error: left > 0 ? `Incorrect code. ${left} ${left === 1 ? "attempt" : "attempts"} left.` : "Too many incorrect attempts. Request a new code." };
  }

  // The code is single use: replace it with a random value and issue a short-lived reset token.
  const token = randomBytes(32).toString("hex");
  await db
    .update(passwordResets)
    .set({
      codeHash: hashOtp(generateOtp()),
      expiresAt: now,
      attempts: 0,
      resetTokenHash: sha256(token),
      resetTokenExpiresAt: new Date(now.getTime() + RESET_TOKEN_MINUTES * 60_000),
    })
    .where(eq(passwordResets.email, email));
  return { ok: true, resetToken: token };
}

export async function completePasswordReset(email: string, token: string, password: string): Promise<ResetStep> {
  if (password.length < 8) return { ok: false, status: 400, error: "The new password must be at least 8 characters." };
  const [row] = await db.select().from(passwordResets).where(eq(passwordResets.email, email)).limit(1);
  const now = new Date();
  if (!row || !row.resetTokenHash || !row.resetTokenExpiresAt || row.resetTokenExpiresAt.getTime() <= now.getTime() || row.resetTokenHash !== sha256(token)) {
    return { ok: false, status: 400, error: "This reset link has expired. Start the password reset again." };
  }
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) return { ok: false, status: 400, error: "This reset link has expired. Start the password reset again." };

  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: hashPassword(password), mustChangePassword: false }).where(eq(users.id, user.id));
    // Anyone holding an old session (possibly the person who lost the password) is signed out.
    await tx.delete(sessions).where(eq(sessions.userId, user.id));
    await tx.delete(passwordResets).where(eq(passwordResets.email, email));
  });
  return { ok: true };
}
