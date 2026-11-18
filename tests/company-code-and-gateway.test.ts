import assert from "node:assert/strict";
import { test } from "node:test";
import { COMPANY_CODE_ALPHABET, generateCompanyCode, isCompanyCode, normalizeCompanyCode } from "../src/lib/company-code-core.ts";
import { isRealSecret, refundOutcome } from "../src/lib/payments-core.ts";

test("generated codes have the CO-XXXX-XXXX form and only unambiguous characters", () => {
  for (let i = 0; i < 200; i++) {
    const code = generateCompanyCode();
    assert.ok(isCompanyCode(code), code);
    assert.doesNotMatch(code.slice(3), /[0OIL1]/, "no look-alike characters in the code body");
  }
});

test("a fixed picker produces a predictable code", () => {
  assert.equal(generateCompanyCode(() => 0), "CO-2222-2222");
  assert.equal(generateCompanyCode(() => COMPANY_CODE_ALPHABET.length - 1), "CO-ZZZZ-ZZZZ");
});

test("the admin can type a code loosely and still find it", () => {
  assert.equal(normalizeCompanyCode("co 7k3d 9pmq"), "CO-7K3D-9PMQ");
  assert.equal(normalizeCompanyCode("CO7K3D9PMQ"), "CO-7K3D-9PMQ");
  assert.equal(normalizeCompanyCode("7k3d-9pmq"), null, "the CO prefix is required");
  assert.equal(normalizeCompanyCode("CO-7K3D-9P0Q"), null, "zero is not a valid character");
  assert.equal(normalizeCompanyCode(""), null);
  assert.equal(normalizeCompanyCode(undefined), null);
});

test("placeholder keys are not treated as configured", () => {
  assert.equal(isRealSecret("YOUR_RAZORPAY_KEY"), false);
  assert.equal(isRealSecret("YOUR_RAZORPAY_SECRET"), false);
  assert.equal(isRealSecret("change-me-to-a-long-random-string"), false);
  assert.equal(isRealSecret(""), false);
  assert.equal(isRealSecret(undefined), false);
  assert.equal(isRealSecret("rzp_test_1A2b3C4d5E"), true);
});

test("refund classification: none, partial, full", () => {
  assert.equal(refundOutcome(9900 * 100, 0), "none");
  assert.equal(refundOutcome(9900 * 100, 4000 * 100), "partial");
  assert.equal(refundOutcome(9900 * 100, 9900 * 100), "full");
  assert.equal(refundOutcome(9900 * 100, 10000 * 100), "full");
});
