import { test } from "node:test";
import assert from "node:assert/strict";
import { isNativeAppUserAgent, isNativeRequestHeaders, readCookie } from "../src/lib/app-platform-core.ts";
import { validateStoreUrl, validateAppFile, safeDownloadName, MAX_APP_FILE_BYTES, validateRegistrationUrl, DEFAULT_REGISTRATION_URL } from "../src/lib/app-links-core.ts";

const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const NOT_ZIP = new Uint8Array([0x3c, 0x68, 0x74, 0x6d]);

test("the mobile app is recognised only by its user-agent token", () => {
  assert.equal(isNativeAppUserAgent("Mozilla/5.0 (Linux; Android 14) Chrome/120 DotinoutNative/1"), true);
  assert.equal(isNativeAppUserAgent("Mozilla/5.0 (iPhone) Mobile/15E148 DotinoutNative/1"), true);
  assert.equal(isNativeAppUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/120"), false);
  assert.equal(isNativeAppUserAgent(null), false);
  assert.equal(isNativeAppUserAgent(undefined), false);
});

test("store links: empty clears, https on the store's own domain only", () => {
  assert.deepEqual(validateStoreUrl("play", ""), { ok: true, value: null });
  assert.deepEqual(validateStoreUrl("play", "   "), { ok: true, value: null });
  assert.equal(validateStoreUrl("play", "https://play.google.com/store/apps/details?id=com.dotinout.app").ok, true);
  assert.equal(validateStoreUrl("appstore", "https://apps.apple.com/app/dotinout/id123").ok, true);
  assert.equal(validateStoreUrl("appstore", "https://testflight.apple.com/join/abc").ok, true);
  assert.equal(validateStoreUrl("play", "http://play.google.com/store/apps").ok, false);
  assert.equal(validateStoreUrl("play", "https://evil.example.com/play.google.com").ok, false);
  assert.equal(validateStoreUrl("appstore", "https://play.google.com/store/apps").ok, false);
  assert.equal(validateStoreUrl("play", "not a url").ok, false);
  assert.equal(validateStoreUrl("play", 42).ok, false);
});

test("app files: correct extension per platform, zip container, size limit", () => {
  assert.equal(validateAppFile("android", "dotinout.apk", 1000, ZIP).ok, true);
  assert.equal(validateAppFile("ios", "dotinout.ipa", 1000, ZIP).ok, true);
  assert.equal(validateAppFile("android", "dotinout.ipa", 1000, ZIP).ok, false);
  assert.equal(validateAppFile("ios", "dotinout.apk", 1000, ZIP).ok, false);
  assert.equal(validateAppFile("android", "dotinout.apk", 1000, NOT_ZIP).ok, false);
  assert.equal(validateAppFile("android", "dotinout.apk", 0, ZIP).ok, false);
  assert.equal(validateAppFile("android", "dotinout.apk", MAX_APP_FILE_BYTES + 1, ZIP).ok, false);
});

test("download file names are cleaned", () => {
  assert.equal(safeDownloadName('my app (v2)".apk'), "my_app__v2__.apk");
  assert.equal(safeDownloadName(""), "dotinout-app");
});

test("registration link: any https website, empty restores the default", () => {
  assert.deepEqual(validateRegistrationUrl(""), { ok: true, value: DEFAULT_REGISTRATION_URL });
  assert.equal(validateRegistrationUrl("https://dotinout.com").ok, true);
  assert.equal(validateRegistrationUrl("http://dotinout.com").ok, false);
  assert.equal(validateRegistrationUrl("dotinout.com").ok, false);
});

test("the app is recognised by its user-agent or by the remembered cookie", () => {
  assert.equal(isNativeRequestHeaders("Mozilla/5.0 DotinoutNative/1", null), true);
  assert.equal(isNativeRequestHeaders("Mozilla/5.0 (Linux) Chrome/120", "theme=dark; dio_native=1"), true);
  assert.equal(isNativeRequestHeaders("Mozilla/5.0 (Windows) Chrome/120", "theme=dark"), false);
  assert.equal(isNativeRequestHeaders(null, "dio_native=0"), false);
  assert.equal(readCookie("a=1; dio_native=1; b=2", "dio_native"), "1");
  assert.equal(readCookie(null, "dio_native"), undefined);
});
