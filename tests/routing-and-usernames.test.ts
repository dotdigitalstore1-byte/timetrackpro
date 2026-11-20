import { test } from "node:test";
import assert from "node:assert/strict";
import { homePathFor, canOpenSpecialistArea } from "../src/lib/home.ts";
import { parseUsername, EMAIL_NOT_ALLOWED } from "../src/lib/username-core.ts";

test("each role starts on its own home page", () => {
  assert.equal(homePathFor("onboarding_specialist"), "/specialist");
  assert.equal(homePathFor("super_admin"), "/superadmin");
  assert.equal(homePathFor("company_admin"), "/dashboard");
  assert.equal(homePathFor("manager"), "/dashboard");
  assert.equal(homePathFor("employee"), "/dashboard");
});

test("specialists may only stay in the specialist area and their profile", () => {
  assert.equal(canOpenSpecialistArea("/specialist"), true);
  assert.equal(canOpenSpecialistArea("/specialist/anything"), true);
  assert.equal(canOpenSpecialistArea("/profile"), true);
  assert.equal(canOpenSpecialistArea("/dashboard"), false);
  assert.equal(canOpenSpecialistArea("/attendance"), false);
  assert.equal(canOpenSpecialistArea("/specialistx"), false);
});

test("usernames are trimmed, lowercased and checked for length and spaces", () => {
  const ok = parseUsername("  Asif.K_01 ");
  assert.deepEqual(ok, { ok: true, value: "asif.k_01" });
  assert.equal(parseUsername("ab").ok, false);
  assert.equal(parseUsername("a".repeat(31)).ok, false);
  assert.equal(parseUsername("has space").ok, false);
  assert.equal(parseUsername("").ok, false);
});

test("an email ID is rejected as a username with the exact warning text", () => {
  for (const email of ["asif@gmail.com", "@gmail.com", "x@y"]) {
    const r = parseUsername(email);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, EMAIL_NOT_ALLOWED);
  }
  assert.equal(EMAIL_NOT_ALLOWED, "Email IDs are not accepted here. Please enter a username.");
});
