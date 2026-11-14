import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDayKey,
  diffDayKeys,
  isDayKey,
  lastWorkingDayOf,
  noticePhase,
  signatureMatches,
  validNoticeDays,
} from "../src/lib/notice.ts";
import {
  agreementStatusFor,
  blocksPunchIn,
  firstPunchBlocker,
  showsPopup,
  type AckRecord,
} from "../src/lib/agreements.ts";
import { parseLogoDataUrl, LOGO_MAX_CHARS } from "../src/lib/logo.ts";

// ---------------------------------------------------------------- notice

test("notice: a 30-day notice starting 1 Nov ends on 30 Nov", () => {
  assert.equal(lastWorkingDayOf("2026-11-01", 30), "2026-11-30");
});

test("notice: a 1-day notice ends on its start day", () => {
  assert.equal(lastWorkingDayOf("2026-11-14", 1), "2026-11-14");
});

test("notice: month and year boundaries are handled", () => {
  assert.equal(lastWorkingDayOf("2026-12-20", 15), "2027-01-03");
  assert.equal(addDayKey("2028-02-28", 1), "2028-02-29"); // leap year
  assert.equal(addDayKey("2027-02-28", 1), "2027-03-01");
});

test("notice: diffDayKeys counts whole days either way", () => {
  assert.equal(diffDayKeys("2026-11-10", "2026-11-14"), 4);
  assert.equal(diffDayKeys("2026-11-14", "2026-11-10"), -4);
});

test("notice: phase upcoming, serving and ended", () => {
  assert.deepEqual(noticePhase("2026-11-20", "2026-12-19", "2026-11-14"), { phase: "upcoming", daysLeft: 36 });
  assert.deepEqual(noticePhase("2026-11-01", "2026-11-30", "2026-11-14"), { phase: "serving", daysLeft: 17 });
  assert.deepEqual(noticePhase("2026-11-01", "2026-11-30", "2026-11-30"), { phase: "serving", daysLeft: 1 });
  assert.deepEqual(noticePhase("2026-11-01", "2026-11-30", "2026-12-01"), { phase: "ended", daysLeft: 0 });
});

test("notice: days must be whole numbers within the policy maximum", () => {
  assert.equal(validNoticeDays(30, 90), 30);
  assert.equal(validNoticeDays("45", 90), 45);
  assert.equal(validNoticeDays(0, 90), null);
  assert.equal(validNoticeDays(91, 90), null);
  assert.equal(validNoticeDays(12.5, 90), null);
  assert.equal(validNoticeDays("", 90), null);
  assert.equal(validNoticeDays("abc", 90), null);
  assert.equal(validNoticeDays(400, 999), null); // hard limit of 365
});

test("notice: date keys must be real calendar dates", () => {
  assert.equal(isDayKey("2026-11-14"), true);
  assert.equal(isDayKey("2026-02-30"), false);
  assert.equal(isDayKey("14-11-2026"), false);
  assert.equal(isDayKey(null), false);
});

test("notice: signature must match the account name, ignoring case, spacing and punctuation", () => {
  assert.equal(signatureMatches("Priya  Sharma", "priya sharma"), true);
  assert.equal(signatureMatches("  PRIYA SHARMA. ", "Priya Sharma"), true);
  assert.equal(signatureMatches("Priya", "Priya Sharma"), false);
  assert.equal(signatureMatches("", "Priya Sharma"), false);
  assert.equal(signatureMatches(undefined, "Priya Sharma"), false);
});

// ---------------------------------------------------------------- agreements

const TODAY = "2026-11-14";
const YESTERDAY = "2026-11-13";

test("agreements: nothing answered means pending, popup shown, punching blocked", () => {
  const status = agreementStatusFor(1, [], TODAY);
  assert.equal(status, "pending");
  assert.equal(showsPopup(status), true);
  assert.equal(blocksPunchIn(status), true);
});

test("agreements: accepting for today lets them punch, but the popup comes back on the next open", () => {
  const acks: AckRecord[] = [{ version: 1, response: "accepted", permanent: false, workDate: TODAY }];
  const status = agreementStatusFor(1, acks, TODAY);
  assert.equal(status, "accepted_today");
  assert.equal(blocksPunchIn(status), false);
  assert.equal(showsPopup(status), true);
});

test("agreements: an accept from yesterday does not carry over to today", () => {
  const acks: AckRecord[] = [{ version: 1, response: "accepted", permanent: false, workDate: YESTERDAY }];
  assert.equal(agreementStatusFor(1, acks, TODAY), "pending");
});

test("agreements: 'don't show again' is permanent and hides the popup", () => {
  const acks: AckRecord[] = [{ version: 1, response: "accepted", permanent: true, workDate: "2026-10-01" }];
  const status = agreementStatusFor(1, acks, TODAY);
  assert.equal(status, "permanent");
  assert.equal(showsPopup(status), false);
  assert.equal(blocksPunchIn(status), false);
});

test("agreements: an edited agreement (new version) asks everyone again", () => {
  const acks: AckRecord[] = [{ version: 1, response: "accepted", permanent: true, workDate: "2026-10-01" }];
  assert.equal(agreementStatusFor(2, acks, TODAY), "pending");
});

test("agreements: declining blocks punching for that day only", () => {
  const acks: AckRecord[] = [{ version: 1, response: "declined", permanent: false, workDate: TODAY }];
  const today = agreementStatusFor(1, acks, TODAY);
  assert.equal(today, "declined_today");
  assert.equal(blocksPunchIn(today), true);
  assert.equal(agreementStatusFor(1, acks, "2026-11-15"), "pending");
});

test("agreements: firstPunchBlocker reports the first agreement that blocks", () => {
  const blockers = firstPunchBlocker(
    [
      { title: "Code of conduct", version: 1, acks: [{ version: 1, response: "accepted", permanent: true, workDate: "2026-10-01" }] },
      { title: "Data policy", version: 3, acks: [] },
    ],
    TODAY
  );
  assert.deepEqual(blockers, { title: "Data policy", status: "pending" });
  assert.equal(firstPunchBlocker([], TODAY), null);
});

// ---------------------------------------------------------------- logo

test("logo: accepts PNG, JPEG and WebP data URLs and decodes the bytes", () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const parsed = parseLogoDataUrl(png);
  assert.ok(parsed);
  assert.equal(parsed.mime, "image/png");
  assert.equal(parsed.bytes[0], 0x89);
  assert.equal(parseLogoDataUrl("data:image/jpeg;base64,/9j/4AAQ")?.mime, "image/jpeg");
  assert.equal(parseLogoDataUrl("data:image/webp;base64,UklGRg==")?.mime, "image/webp");
});

test("logo: rejects other types, malformed data and oversize values", () => {
  assert.equal(parseLogoDataUrl("data:image/svg+xml;base64,PHN2Zz4="), null);
  assert.equal(parseLogoDataUrl("data:text/html;base64,PGh0bWw+"), null);
  assert.equal(parseLogoDataUrl("not a data url"), null);
  assert.equal(parseLogoDataUrl(null), null);
  assert.equal(parseLogoDataUrl("data:image/png;base64," + "A".repeat(LOGO_MAX_CHARS)), null);
});
