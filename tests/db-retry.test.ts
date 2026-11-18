import assert from "node:assert/strict";
import { test } from "node:test";
import { isTransientDbError, withTransientRetry } from "../src/lib/db-retry.ts";

test("connection-level failures are transient", () => {
  assert.equal(isTransientDbError({ code: "ECONNRESET", message: "read ECONNRESET" }), true);
  assert.equal(isTransientDbError(new Error("Connection terminated unexpectedly")), true);
  assert.equal(isTransientDbError(new Error("timeout exceeded when trying to connect")), true);
  assert.equal(isTransientDbError({ code: "57P03", message: "the database system is starting up" }), true);
  // Wrapped errors (drizzle puts the driver error on `cause`)
  assert.equal(isTransientDbError({ message: "Failed query", cause: { code: "ECONNREFUSED" } }), true);
});

test("validation and constraint errors are not retried", () => {
  assert.equal(isTransientDbError({ code: "23505", message: "duplicate key value violates unique constraint" }), false);
  assert.equal(isTransientDbError(new Error("Email already in use.")), false);
  assert.equal(isTransientDbError(null), false);
  assert.equal(isTransientDbError("string error"), false);
});

test("retries a dropped connection and then succeeds", async () => {
  let calls = 0;
  const value = await withTransientRetry(
    async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error("Connection terminated"), { code: "ECONNRESET" });
      return "ok";
    },
    { baseDelayMs: 1 }
  );
  assert.equal(value, "ok");
  assert.equal(calls, 2);
});

test("gives up after the attempts and does not retry real errors", async () => {
  let calls = 0;
  await assert.rejects(
    withTransientRetry(
      async () => {
        calls++;
        throw Object.assign(new Error("reset"), { code: "ECONNRESET" });
      },
      { attempts: 3, baseDelayMs: 1 }
    )
  );
  assert.equal(calls, 3);

  calls = 0;
  await assert.rejects(
    withTransientRetry(async () => {
      calls++;
      throw new Error("Email already in use.");
    }, { baseDelayMs: 1 })
  );
  assert.equal(calls, 1, "a real error is thrown on the first attempt");
});
