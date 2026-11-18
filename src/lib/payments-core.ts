// Gateway signature checks. Pure functions (node crypto only) so they can be unit-tested with fixed vectors.
import { createHmac, timingSafeEqual } from "crypto";

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Razorpay: HMAC-SHA256 of "order_id|payment_id" with the key secret, hex encoded. Checked after the browser checkout. */
export function razorpayPaymentSignatureValid(orderId: string, paymentId: string, signature: string, keySecret: string): boolean {
  const expected = createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqual(expected, signature);
}

/** Razorpay webhooks: HMAC-SHA256 of the raw request body with the webhook secret, hex encoded (X-Razorpay-Signature). */
export function razorpayWebhookSignatureValid(rawBody: string, signature: string, webhookSecret: string): boolean {
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return safeEqual(expected, signature);
}

/** Cashfree webhooks: base64 HMAC-SHA256 of (timestamp + raw body) with the secret key (x-webhook-signature). */
export function cashfreeWebhookSignatureValid(rawBody: string, timestamp: string, signature: string, secretKey: string): boolean {
  const expected = createHmac("sha256", secretKey).update(timestamp + rawBody).digest("base64");
  return safeEqual(expected, signature);
}

/**
 * True when a configuration value is a real secret. Placeholders copied from the example file (YOUR_RAZORPAY_KEY,
 * change-me-...) count as not configured, so the app never calls the gateway with them.
 */
export function isRealSecret(value: string | undefined | null): boolean {
  const v = (value ?? "").trim();
  if (!v) return false;
  if (/^your[_-]/i.test(v) || /^change[-_]me/i.test(v)) return false;
  return true;
}

export type RefundOutcome = "none" | "partial" | "full";

/** How much of a captured payment has been returned. Amounts in paise (Razorpay's unit) or any one consistent unit. */
export function refundOutcome(capturedAmount: number, refundedAmount: number): RefundOutcome {
  if (!(refundedAmount > 0)) return "none";
  return refundedAmount >= capturedAmount ? "full" : "partial";
}
