// Outbound email for one-time codes. Uses the Resend HTTP API (no SDK, so no extra dependency).
// If no provider is configured, or the provider fails, the code is written to the server console
// when the fallback is allowed (always in development; in production only with OTP_CONSOLE_FALLBACK=true).
import { OTP_TTL_MINUTES, otpConsoleFallbackAllowed } from "@/lib/otp-core";

export type OtpDelivery = "email" | "console";
export type OtpPurpose = "register" | "reset";

export class OtpDeliveryError extends Error {}

export async function deliverOtp(to: string, code: string, label: string, purpose: OtpPurpose = "register"): Promise<OtpDelivery> {
  const env = process.env;
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM;
  const subject =
    purpose === "reset" ? "Your TimeTrack Pro password reset code" : "Your TimeTrack Pro verification code";
  const intro =
    purpose === "reset"
      ? `Your code to reset the password for your TimeTrack Pro account (${label}) is:`
      : `Your verification code to create the workspace "${label}" is:`;
  const text =
    `Hi,\n\n${intro}\n\n${code}\n\n` +
    `It is valid for ${OTP_TTL_MINUTES} minutes. If you did not ask for this, you can ignore this email.`;

  let failure: string;
  if (apiKey && from) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return "email";
      failure = `email provider responded with HTTP ${res.status}`;
    } catch {
      failure = "email provider could not be reached";
    }
  } else {
    failure = "no email provider is configured (set RESEND_API_KEY and MAIL_FROM)";
  }

  if (otpConsoleFallbackAllowed(env)) {
    console.log(
      [
        "",
        "==================================================",
        ` TimeTrack Pro - ${purpose === "reset" ? "password reset" : "email verification"} code (dev fallback)`,
        `  Reason : ${failure}`,
        `  To     : ${to}`,
        `  Code   : ${code}  (valid ${OTP_TTL_MINUTES} minutes)`,
        "==================================================",
        "",
      ].join("\n")
    );
    return "console";
  }

  console.error("OTP email not sent:", failure);
  throw new OtpDeliveryError("We could not send the email right now. Please try again in a few minutes.");
}
