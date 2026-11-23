import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { blockedMessage, readDeviceSecurity } from "../src/lib/device-security.ts";

// The module reads navigator and window, so each test sets them up the way the Android WebView would.
const realNavigator = globalThis.navigator;
const realWindow = (globalThis as { window?: unknown }).window;

function setEnv(opts: { userAgent?: string; bridge?: unknown }) {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: opts.userAgent ?? "" },
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: opts.bridge === undefined ? {} : { TimeTrackNative: opts.bridge },
    configurable: true,
  });
}

const ANDROID_APP = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile DotinoutNative/1";
const IOS_APP = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 DotinoutNative/1";
const WEB = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15";


afterEach(() => {
  Object.defineProperty(globalThis, "navigator", { value: realNavigator, configurable: true });
  Object.defineProperty(globalThis, "window", { value: realWindow, configurable: true });
});

test("web and iOS are not subject to the Android device check", () => {
  setEnv({ userAgent: WEB, bridge: { securityStatus: () => '{"blocked":true}' } });
  assert.equal(readDeviceSecurity().applicable, false);
  assert.equal(readDeviceSecurity().blocked, false);
  setEnv({ userAgent: IOS_APP });
  assert.equal(readDeviceSecurity().applicable, false);
});

test("Android app with a clean device is not blocked", () => {
  setEnv({
    userAgent: ANDROID_APP,
    bridge: { securityStatus: () => '{"blocked":false,"developerOptions":false,"mockLocation":false}' },
  });
  const s = readDeviceSecurity();
  assert.equal(s.applicable, true);
  assert.equal(s.blocked, false);
  assert.equal(s.unverified, false);
});

test("Developer Options blocks the app and names the setting", () => {
  setEnv({
    userAgent: ANDROID_APP,
    bridge: { securityStatus: () => '{"blocked":true,"developerOptions":true,"mockLocation":false}' },
  });
  const s = readDeviceSecurity();
  assert.equal(s.blocked, true);
  assert.equal(s.developerOptions, true);
  assert.match(blockedMessage(s), /Developer Options/);
});

test("mock location blocks the app and names the setting", () => {
  setEnv({
    userAgent: ANDROID_APP,
    bridge: { securityStatus: () => '{"blocked":true,"developerOptions":false,"mockLocation":true}' },
  });
  const s = readDeviceSecurity();
  assert.equal(s.blocked, true);
  assert.equal(s.mockLocation, true);
  assert.match(blockedMessage(s), /mock location/);
});

test("a missing bridge fails closed on Android", () => {
  setEnv({ userAgent: ANDROID_APP });
  const s = readDeviceSecurity();
  assert.equal(s.blocked, true);
  assert.equal(s.unverified, true);
});

test("a malformed answer from the bridge fails closed", () => {
  setEnv({ userAgent: ANDROID_APP, bridge: { securityStatus: () => "not json" } });
  assert.equal(readDeviceSecurity().blocked, true);
  setEnv({ userAgent: ANDROID_APP, bridge: { securityStatus: () => '{"developerOptions":false}' } });
  assert.equal(readDeviceSecurity().blocked, true);
});
