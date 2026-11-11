import assert from "node:assert/strict";
import { test } from "node:test";
import { recordCutoff, RECORD_RETENTION_DAYS, SLIP_ACCESS_DAYS, photoCutoff, PHOTO_RETENTION_DAYS } from "../src/lib/payroll.ts";
import { CHALLENGE_MAX_AGE_MS, signChallenge, verifyChallenge } from "../src/lib/capture-token.ts";

const today = new Date("2026-12-01T00:00:00Z");

test("retention windows are 45 days for photos, 90 days for records, 90 days for slips", () => {
  assert.equal(PHOTO_RETENTION_DAYS, 45);
  assert.equal(RECORD_RETENTION_DAYS, 90);
  assert.equal(SLIP_ACCESS_DAYS, 90);
});

test("records older than 90 days are cut off; photos older than 45 days are cut off", () => {
  assert.equal(recordCutoff(today).toISOString().slice(0, 10), "2026-09-02");
  assert.equal(photoCutoff(today).toISOString().slice(0, 10), "2026-10-17");
});

test("a fresh challenge verifies for the same session", () => {
  const now = Date.now();
  const sig = signChallenge("session-token-A", now);
  assert.equal(verifyChallenge("session-token-A", now, sig, now + 1000), true);
});

test("a challenge from another session is rejected", () => {
  const now = Date.now();
  const sig = signChallenge("session-token-A", now);
  assert.equal(verifyChallenge("session-token-B", now, sig, now), false);
});

test("a stored or replayed challenge older than the window is rejected", () => {
  const ts = Date.now();
  const sig = signChallenge("session-token-A", ts);
  assert.equal(verifyChallenge("session-token-A", ts, sig, ts + CHALLENGE_MAX_AGE_MS + 1), false);
});

test("tampered or malformed challenges are rejected", () => {
  const ts = Date.now();
  const sig = signChallenge("session-token-A", ts);
  assert.equal(verifyChallenge("session-token-A", ts + 1, sig, ts), false);
  assert.equal(verifyChallenge("session-token-A", ts, "not-hex", ts), false);
  assert.equal(verifyChallenge("session-token-A", undefined, sig, ts), false);
  assert.equal(verifyChallenge("session-token-A", ts, undefined, ts), false);
});
