import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesSuperAdminCredentials, readSuperAdminEnv } from "../src/lib/super-admin.ts";

const env = (email: string, password: string) => ({ SUPER_ADMIN_EMAIL: email, SUPER_ADMIN_PASSWORD: password });

test("matches the configured owner credentials (email is trimmed and case-insensitive)", () => {
  const e = env("Owner@Platform.com", "s3cret!");
  assert.equal(matchesSuperAdminCredentials("owner@platform.com", "s3cret!", e), true);
  assert.equal(matchesSuperAdminCredentials("  OWNER@platform.com  ", "s3cret!", e), true);
});

test("rejects a wrong password, a wrong email, or missing environment values", () => {
  const e = env("owner@platform.com", "s3cret!");
  assert.equal(matchesSuperAdminCredentials("owner@platform.com", "wrong", e), false);
  assert.equal(matchesSuperAdminCredentials("other@platform.com", "s3cret!", e), false);
  assert.equal(matchesSuperAdminCredentials("owner@platform.com", "s3cret!", {}), false);
});

test("picks up rotated environment credentials on the next check", () => {
  const before = env("owner@platform.com", "old-pass");
  const after = env("new-owner@platform.com", "new-pass");

  assert.equal(matchesSuperAdminCredentials("owner@platform.com", "old-pass", before), true);
  assert.equal(matchesSuperAdminCredentials("owner@platform.com", "old-pass", after), false);
  assert.equal(matchesSuperAdminCredentials("new-owner@platform.com", "new-pass", after), true);
  assert.equal(matchesSuperAdminCredentials("new-owner@platform.com", "new-pass", before), false);
});

test("readSuperAdminEnv normalizes the email and requires both values", () => {
  assert.deepEqual(readSuperAdminEnv(env(" Owner@Platform.com ", "pw")), {
    email: "owner@platform.com",
    password: "pw",
  });
  assert.equal(readSuperAdminEnv({ SUPER_ADMIN_EMAIL: "owner@platform.com" }), null);
  assert.equal(readSuperAdminEnv({ SUPER_ADMIN_PASSWORD: "pw" }), null);
});