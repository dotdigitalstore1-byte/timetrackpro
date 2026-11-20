// Outbound email for one-time codes. Provider is chosen by environment variables:
//   ZeptoMail (default when ZEPTOMAIL_TOKEN is set):  ZEPTOMAIL_TOKEN, MAIL_FROM_ADDRESS, MAIL_FROM_NAME,
//                                                     optional ZEPTOMAIL_API_URL (use the regional host, e.g. zeptomail.in or zeptomail.eu)
//   Resend (when RESEND_API_KEY is set and MAIL_PROVIDER=resend): RESEND_API_KEY, MAIL_FROM_ADDRESS
// If the provider is missing or fails, the code is written to the server console ONLY in development, or in production
// when OTP_CONSOLE_FALLBACK=true. Production never shows the code to the user.
import { OTP_TTL_MINUTES, otpConsoleFallbackAllowed } from "@/lib/otp-core";
import { isRealSecret } from "@/lib/payments-core";

export type OtpDelivery = "email" | "console";
export type OtpPurpose = "register" | "reset";

export class OtpDeliveryError extends Error {}

const DEFAULT_ZEPTOMAIL_URL = "https://api.zeptomail.com/v1.1/email";

interface Message {
  to: string;
  subject: string;
  text: string;
}

function buildMessage(to: string, code: string, label: string, purpose: OtpPurpose): Message {
  const subject = purpose === "reset" ? "Your Dotinout password reset code" : "Your Dotinout verification code";
  const intro =
    purpose === "reset"
      ? `Your code to reset the password for your Dotinout account (${label}) is:`
      : `Your verification code to create the workspace "${label}" is:`;
  const text =
    `Hi,\n\n${intro}\n\n${code}\n\n` +
    `It is valid for ${OTP_TTL_MINUTES} minutes. If you did not ask for this, you can ignore this email.`;
  return { to, subject, text };
}

/** ZeptoMail accepts the token with or without its "Zoho-enczapikey " prefix. */
function zeptoAuthHeader(token: string): string {
  const t = token.trim();
  return /^zoho-enczapikey\s/i.test(t) ? t : `Zoho-enczapikey ${t}`;
}

async function sendViaZeptoMail(msg: Message, env: NodeJS.ProcessEnv): Promise<string | null> {
  const from = env.MAIL_FROM_ADDRESS;
  if (!from) return "MAIL_FROM_ADDRESS is not set";
  const res = await fetch(env.ZEPTOMAIL_API_URL || DEFAULT_ZEPTOMAIL_URL, {
    method: "POST",
    headers: {
      Authorization: zeptoAuthHeader(env.ZEPTOMAIL_TOKEN ?? ""),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      from: { address: from, name: env.MAIL_FROM_NAME || "Dotinout" },
      to: [{ email_address: { address: msg.to, name: msg.to } }],
      subject: msg.subject,
      textbody: msg.text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) return null;
  const detail = (await res.text().catch(() => "")).slice(0, 300);
  console.error("ZeptoMail rejected the message", res.status, detail);
  return `email provider responded with HTTP ${res.status}`;
}

async function sendViaResend(msg: Message, env: NodeJS.ProcessEnv): Promise<string | null> {
  const from = env.MAIL_FROM_ADDRESS;
  if (!from) return "MAIL_FROM_ADDRESS is not set";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) return null;
  return `email provider responded with HTTP ${res.status}`;
}

// Placeholder tokens (YOUR_...) count as not configured, so nothing is sent with them.
function chosenProvider(env: NodeJS.ProcessEnv): "zeptomail" | "resend" | null {
  const zepto = isRealSecret(env.ZEPTOMAIL_TOKEN);
  const resend = isRealSecret(env.RESEND_API_KEY);
  const explicit = (env.MAIL_PROVIDER || "").toLowerCase();
  if (explicit === "zeptomail" && zepto) return "zeptomail";
  if (explicit === "resend" && resend) return "resend";
  if (!explicit && zepto) return "zeptomail";
  if (!explicit && resend) return "resend";
  return null;
}

export async function deliverOtp(to: string, code: string, label: string, purpose: OtpPurpose = "register"): Promise<OtpDelivery> {
  const env = process.env;
  const msg = buildMessage(to, code, label, purpose);
  const provider = chosenProvider(env);

  let failure: string | null;
  if (!provider) {
    failure = "no email provider is configured (set ZEPTOMAIL_TOKEN and MAIL_FROM_ADDRESS)";
  } else {
    try {
      failure = provider === "zeptomail" ? await sendViaZeptoMail(msg, env) : await sendViaResend(msg, env);
    } catch (e) {
      console.error("email provider error", e);
      failure = "email provider could not be reached";
    }
  }
  if (failure === null) return "email";

  if (otpConsoleFallbackAllowed(env)) {
    console.log(
      [
        "",
        "==================================================",
        ` Dotinout - ${purpose === "reset" ? "password reset" : "email verification"} code (development only)`,
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
