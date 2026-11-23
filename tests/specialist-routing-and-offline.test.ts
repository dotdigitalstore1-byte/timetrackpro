import { test } from "node:test";
import assert from "node:assert/strict";
import { entryPathFor, homePathFor, canOpenSpecialistArea } from "../src/lib/home.ts";
import { parseIdempotencyKey } from "../src/lib/idempotency-core.ts";

test("each role lands on its own home page", () => {
  assert.equal(homePathFor("super_admin"), "/superadmin");
  assert.equal(homePathFor("onboarding_specialist"), "/specialist");
  assert.equal(homePathFor("employee"), "/dashboard");
  assert.equal(homePathFor("manager"), "/dashboard");
});

test("only a locked company admin is sent to billing; locked staff are not", () => {
  assert.equal(entryPathFor({ role: "company_admin", locked: true }), "/billing");
  assert.equal(entryPathFor({ role: "company_admin", locked: false }), "/dashboard");
  // Billing is an admin-only screen: a locked employee must never be routed there.
  assert.equal(entryPathFor({ role: "employee", locked: true }), "/dashboard");
  assert.equal(entryPathFor({ role: "onboarding_specialist", locked: true }), "/specialist");
});

test("specialists cannot open attendance screens", () => {
  assert.equal(canOpenSpecialistArea("/specialist"), true);
  assert.equal(canOpenSpecialistArea("/dashboard"), false);
  assert.equal(canOpenSpecialistArea("/leaves"), false);
  assert.equal(canOpenSpecialistArea("/specialistx"), false);
});

test("idempotency keys: missing is allowed, malformed is rejected, valid is trimmed", () => {
  assert.deepEqual(parseIdempotencyKey(null), { key: null, valid: true });
  assert.deepEqual(parseIdempotencyKey("short"), { key: null, valid: false });
  assert.deepEqual(parseIdempotencyKey("bad key with spaces!!"), { key: null, valid: false });
  assert.deepEqual(parseIdempotencyKey("  0f8fad5b-d9cb-469f-a165-8c1a5d1e2b3c  "), {
    key: "0f8fad5b-d9cb-469f-a165-8c1a5d1e2b3c",
    valid: true,
  });
});
