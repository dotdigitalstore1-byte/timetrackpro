import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateOtp,
  hashOtp,
  isOtpShaped,
  otpConsoleFallbackAllowed,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_SECONDS,
  OTP_TTL_MINUTES,
  verifyOtp,
} from "../src/lib/otp-core.ts";

test("codes are six digits, keep leading zeros, and pass the shape check", () => {
  for (let i = 0; i < 200; i++) {
    const code = generateOtp();
    assert.match(code, /^\d{6}$/);
    assert.equal(isOtpShaped(code), true);
  }
  assert.equal(isOtpShaped("12345"), false);
  assert.equal(isOtpShaped("12a456"), false);
});

test("stored hash verifies the right code only, and never contains the code", () => {
  const stored = hashOtp("049173");
  assert.equal(verifyOtp("049173", stored), true);
  assert.equal(verifyOtp("049174", stored), false);
  assert.equal(stored.includes("049173"), false);
  assert.equal(verifyOtp("049173", "not-a-hash"), false);
});

test("the same code hashes differently each time (per-record salt)", () => {
  assert.notEqual(hashOtp("123456"), hashOtp("123456"));
});

test("console fallback: allowed in development, blocked in production unless opted in", () => {
  assert.equal(otpConsoleFallbackAllowed({ NODE_ENV: "development" }), true);
  assert.equal(otpConsoleFallbackAllowed({}), true);
  assert.equal(otpConsoleFallbackAllowed({ NODE_ENV: "production" }), false);
  assert.equal(otpConsoleFallbackAllowed({ NODE_ENV: "production", OTP_CONSOLE_FALLBACK: "true" }), true);
});

test("policy constants", () => {
  assert.equal(OTP_TTL_MINUTES, 10);
  assert.equal(OTP_MAX_ATTEMPTS, 5);
  assert.equal(OTP_RESEND_SECONDS, 60);
});
