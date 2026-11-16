import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  cashfreeWebhookSignatureValid,
  razorpayPaymentSignatureValid,
  razorpayWebhookSignatureValid,
} from "../src/lib/payments-core.ts";

test("Razorpay checkout signature: accepts the genuine signature and rejects any change", () => {
  const secret = "key_secret_test";
  const sig = createHmac("sha256", secret).update("order_ABC|pay_XYZ").digest("hex");
  assert.equal(razorpayPaymentSignatureValid("order_ABC", "pay_XYZ", sig, secret), true);
  assert.equal(razorpayPaymentSignatureValid("order_ABD", "pay_XYZ", sig, secret), false);
  assert.equal(razorpayPaymentSignatureValid("order_ABC", "pay_XYZ", sig, "other"), false);
  assert.equal(razorpayPaymentSignatureValid("order_ABC", "pay_XYZ", "short", secret), false);
});

test("Razorpay webhook signature covers the exact raw body", () => {
  const body = '{"event":"payment.captured"}';
  const sig = createHmac("sha256", "whsec").update(body).digest("hex");
  assert.equal(razorpayWebhookSignatureValid(body, sig, "whsec"), true);
  assert.equal(razorpayWebhookSignatureValid(body + " ", sig, "whsec"), false); // whitespace changes the signature
  assert.equal(razorpayWebhookSignatureValid(body, sig, "wrong"), false);
});

test("Cashfree webhook signature: base64 over timestamp + raw body", () => {
  const body = '{"type":"PAYMENT_SUCCESS_WEBHOOK"}';
  const ts = "1731720000000";
  const sig = createHmac("sha256", "cf_secret").update(ts + body).digest("base64");
  assert.equal(cashfreeWebhookSignatureValid(body, ts, sig, "cf_secret"), true);
  assert.equal(cashfreeWebhookSignatureValid(body, "1731720000001", sig, "cf_secret"), false); // replayed timestamp
  assert.equal(cashfreeWebhookSignatureValid(body, ts, sig, "nope"), false);
});
