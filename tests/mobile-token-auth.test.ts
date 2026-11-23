import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBearerToken } from "../src/lib/app-platform-core.ts";

const TOKEN = "a".repeat(64);

test("accepts a well-formed bearer token", () => {
  assert.equal(parseBearerToken(`Bearer ${TOKEN}`), TOKEN);
});

test("is case-insensitive on the scheme and trims spaces", () => {
  assert.equal(parseBearerToken(`bearer   ${TOKEN}  `), TOKEN);
});

test("normalises token case to lower-case hex", () => {
  assert.equal(parseBearerToken(`Bearer ${"AB".repeat(32)}`), "ab".repeat(32));
});

test("rejects missing or empty headers", () => {
  assert.equal(parseBearerToken(null), null);
  assert.equal(parseBearerToken(undefined), null);
  assert.equal(parseBearerToken(""), null);
});

test("rejects other schemes and wrong lengths", () => {
  assert.equal(parseBearerToken(`Basic ${TOKEN}`), null);
  assert.equal(parseBearerToken(`Bearer ${"a".repeat(63)}`), null);
  assert.equal(parseBearerToken(`Bearer ${"a".repeat(65)}`), null);
});

test("rejects non-hex characters (no injection of arbitrary strings)", () => {
  assert.equal(parseBearerToken(`Bearer ${"g".repeat(64)}`), null);
  assert.equal(parseBearerToken(`Bearer ${"a".repeat(60)}; DROP`), null);
});
