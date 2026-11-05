import assert from "node:assert/strict";
import { test } from "node:test";
import { isUuid, parseIdList } from "../src/lib/ids.ts";
import { parseLocationInput } from "../src/lib/locations.ts";

test("parseIdList de-duplicates, trims and drops blanks / non-arrays", () => {
  assert.deepEqual(parseIdList(["a", " a ", "b", "", null, undefined]), ["a", "b"]);
  assert.deepEqual(parseIdList("not-an-array"), []);
  assert.deepEqual(parseIdList(undefined), []);
  assert.deepEqual(parseIdList([]), []);
});

test("isUuid accepts real uuids only", () => {
  assert.equal(isUuid("3f2b8c1e-9d4a-4b7e-8a11-0c5d2e6f7a90"), true);
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid("1 OR 1=1"), false);
});

test("location: valid payload is normalised", () => {
  const r = parseLocationInput({ name: "  Head   Office ", address: " 12 MG Road ", latitude: "12.9716", longitude: 77.5946, radiusMeters: "250" }, false);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.name, "Head Office");
    assert.equal(r.value.address, "12 MG Road");
    assert.equal(r.value.latitude, "12.9716000");
    assert.equal(r.value.longitude, "77.5946000");
    assert.equal(r.value.radiusMeters, 250);
  }
});

test("location: rejects missing name, bad coordinates and bad radius", () => {
  const base = { name: "HQ", latitude: "10", longitude: "20", radiusMeters: 100 };
  assert.equal(parseLocationInput({ ...base, name: "  " }, false).ok, false);
  assert.equal(parseLocationInput({ ...base, latitude: "" }, false).ok, false);
  assert.equal(parseLocationInput({ ...base, latitude: "91" }, false).ok, false);
  assert.equal(parseLocationInput({ ...base, longitude: "-181" }, false).ok, false);
  assert.equal(parseLocationInput({ ...base, longitude: "abc" }, false).ok, false);
  assert.equal(parseLocationInput({ ...base, radiusMeters: 5 }, false).ok, false);
  assert.equal(parseLocationInput({ ...base, radiusMeters: 99999 }, false).ok, false);
});

test("location: empty latitude is not silently treated as 0", () => {
  const r = parseLocationInput({ name: "HQ", latitude: null, longitude: "20", radiusMeters: 100 }, false);
  assert.equal(r.ok, false);
});

test("location: partial update only validates supplied fields", () => {
  const r = parseLocationInput({ isActive: false }, true);
  assert.deepEqual(r, { ok: true, value: { isActive: false } });
  assert.equal(parseLocationInput({ radiusMeters: 5 }, true).ok, false);
  const addr = parseLocationInput({ address: "   " }, true);
  assert.deepEqual(addr, { ok: true, value: { address: null } });
});
