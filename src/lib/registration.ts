// Company sign-up in two steps: request an email code, then verify it to create the workspace.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { companies, companySettings, pendingRegistrations, users } from "@/db/schema";
import type { PendingRegistrationPayload } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { startTrialTx } from "@/lib/billing";
import { isValidTimezone } from "@/lib/payroll";
import { OtpDeliveryError, deliverOtp, type OtpDelivery } from "@/lib/mailer";
import { generateCompanyCode } from "@/lib/company-code-core";
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_SECONDS,
  generateOtp,
  hashOtp,
  isOtpShaped,
  otpExpiry,
  verifyOtp,
} from "@/lib/otp-core";

export interface RegistrationInput {
  companyName: string;
  adminName: string;
  email: string;
  phone: string;
  password: string;
  timezone: string;
}

export type StepResult<T extends object = object> = ({ ok: true } & T) | { ok: false; status: number; error: string };

/** Step 1: store the sign-up details and email a code. Re-running it sends a fresh code after the cooldown. */
export async function startRegistration(input: RegistrationInput): Promise<StepResult<{ delivery: OtpDelivery }>> {
  const taken = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
  if (taken.length > 0) return { ok: false, status: 409, error: "An account with this email already exists." };

  const now = new Date();
  const [pending] = await db.select().from(pendingRegistrations).where(eq(pendingRegistrations.email, input.email)).limit(1);
  if (pending) {
    const sinceMs = now.getTime() - pending.lastSentAt.getTime();
    if (sinceMs < OTP_RESEND_SECONDS * 1000) {
      const wait = Math.ceil((OTP_RESEND_SECONDS * 1000 - sinceMs) / 1000);
      return { ok: false, status: 429, error: `Please wait ${wait} seconds before requesting another code.` };
    }
  }

  const code = generateOtp();
  const payload: PendingRegistrationPayload = {
    companyName: input.companyName,
    adminName: input.adminName,
    phone: input.phone,
    timezone: isValidTimezone(input.timezone) ? input.timezone : "UTC",
    passwordHash: hashPassword(input.password),
  };
  await db
    .insert(pendingRegistrations)
    .values({ email: input.email, payload, codeHash: hashOtp(code), attempts: 0, expiresAt: otpExpiry(now), lastSentAt: now })
    .onConflictDoUpdate({
      target: pendingRegistrations.email,
      set: { payload, codeHash: hashOtp(code), attempts: 0, expiresAt: otpExpiry(now), lastSentAt: now },
    });

  try {
    const delivery = await deliverOtp(input.email, code, input.companyName);
    return { ok: true, delivery };
  } catch (e) {
    // Nothing was sent, so do not keep a code the user cannot have received.
    await db.delete(pendingRegistrations).where(eq(pendingRegistrations.email, input.email));
    if (e instanceof OtpDeliveryError) return { ok: false, status: 503, error: e.message };
    throw e;
  }
}

/** Step 2: check the code, then create the company, its settings, the trial and the admin account in one transaction. */
export async function completeRegistration(
  email: string,
  code: string
): Promise<StepResult<{ companyId: string; adminId: string; fullName: string }>> {
  if (!isOtpShaped(code)) return { ok: false, status: 400, error: "Enter the 6-digit code from your email." };

  const [pending] = await db.select().from(pendingRegistrations).where(eq(pendingRegistrations.email, email)).limit(1);
  if (!pending) return { ok: false, status: 400, error: "No verification is pending for this email. Start the sign-up again." };

  const now = new Date();
  if (pending.expiresAt.getTime() <= now.getTime()) {
    await db.delete(pendingRegistrations).where(eq(pendingRegistrations.email, email));
    return { ok: false, status: 400, error: "This code has expired. Request a new one." };
  }
  if (pending.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, status: 429, error: "Too many incorrect attempts. Request a new code." };
  }
  if (!verifyOtp(code, pending.codeHash)) {
    const attempts = pending.attempts + 1;
    await db.update(pendingRegistrations).set({ attempts }).where(eq(pendingRegistrations.email, email));
    const left = OTP_MAX_ATTEMPTS - attempts;
    return {
      ok: false,
      status: left > 0 ? 400 : 429,
      error: left > 0 ? `Incorrect code. ${left} ${left === 1 ? "attempt" : "attempts"} left.` : "Too many incorrect attempts. Request a new code.",
    };
  }

  const payload = pending.payload;
  try {
    const created = await db.transaction(async (tx) => {
      const [company] = await tx
        .insert(companies)
        .values({ name: payload.companyName, email, phone: payload.phone, code: generateCompanyCode() })
        .returning();
      await tx.insert(companySettings).values({ companyId: company.id, timezone: payload.timezone });
      await startTrialTx(tx, company.id, now);
      const [admin] = await tx
        .insert(users)
        .values({
          companyId: company.id,
          email,
          passwordHash: payload.passwordHash,
          fullName: payload.adminName,
          role: "company_admin",
          phone: payload.phone,
        })
        .returning();
      await tx.delete(pendingRegistrations).where(eq(pendingRegistrations.email, email));
      return { companyId: company.id, adminId: admin.id, fullName: admin.fullName };
    });
    return { ok: true, ...created };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      await db.delete(pendingRegistrations).where(eq(pendingRegistrations.email, email));
      return { ok: false, status: 409, error: "An account with this email already exists." };
    }
    throw e;
  }
}
