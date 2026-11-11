import assert from "node:assert/strict";
import { test } from "node:test";
import {
  absentCutoffMinutes, cyclePeriod, computeStatus, liveDayState, summarizeMonth, type DayRecord,
} from "../src/lib/payroll.ts";

const TZ = "Asia/Kolkata"; // UTC+5:30
const at = (hhmm: string, day = "2026-11-10") => new Date(`${day}T${hhmm}:00+05:30`);
const DAY = new Date("2026-11-10T00:00:00Z");
const policy = { shiftStart: "09:00", shiftEnd: "18:00", graceMinutes: 5, lateThresholdMinutes: 30, timezone: TZ };

// ---------------------------------------------------------- late-percentage auto-absent
test("50% of a 09:00-18:00 shift: the cut-off is 13:30", () => {
  assert.equal(absentCutoffMinutes("09:00", "18:00", 50), 13 * 60 + 30);
  assert.equal(absentCutoffMinutes("09:00", "18:00", 60), 14 * 60 + 24);
  assert.equal(absentCutoffMinutes("09:00", "18:00", null), null);
  assert.equal(absentCutoffMinutes("09:00", "18:00", 0), null);
});

test("auto-absent: a punch after the cut-off is absent, and before it the normal rules apply", () => {
  const on = { ...policy, absentAfterPercent: 50 };
  assert.equal(computeStatus(at("13:20"), on), "half_day"); // before the cut-off: normal half-day rule
  assert.equal(computeStatus(at("13:30"), on), "half_day"); // exactly on the cut-off is not absent
  assert.equal(computeStatus(at("13:45"), on), "absent"); // after the cut-off: absent, not half day
  assert.equal(computeStatus(at("09:04"), on), "present"); // the normal punch still works
});

test("auto-absent off: a late punch is only a half day, however late", () => {
  assert.equal(computeStatus(at("13:45"), { ...policy, absentAfterPercent: null }), "half_day");
});

test("an absent-by-rule punch counts as an absent day in payroll, exactly like no punch", () => {
  const period = cyclePeriod(2026, 11, 1);
  const common = { year: 2026, month: 11, period, weeklyOff: new Set([0]), approvedLeaves: [], todayLocal: new Date("2026-11-20T00:00:00Z") };
  const marked = summarizeMonth({ ...common, records: new Map<string, DayRecord>([["2026-11-10", { status: "absent", hasPunchIn: true, hasPunchOut: false }]]) });
  const none = summarizeMonth({ ...common, records: new Map<string, DayRecord>() });
  const onTime = summarizeMonth({ ...common, records: new Map<string, DayRecord>([["2026-11-10", { status: "present", hasPunchIn: true, hasPunchOut: true }]]) });
  assert.equal(marked.absentDays, none.absentDays);
  assert.equal(onTime.absentDays, none.absentDays - 1);
  assert.equal(marked.presentDays, none.presentDays);
  assert.equal(onTime.presentDays, none.presentDays + 1);
});

// ---------------------------------------------------------- live roster states
const base = { tz: TZ, workDate: DAY, todayLocal: DAY, shiftStart: "09:00", graceMinutes: 5, onLeave: false, offDay: false };

test("live: no punch-in after the cool-off shows absent (09:10), but waiting inside it (09:03)", () => {
  assert.equal(liveDayState({ ...base, now: at("09:10"), record: null }), "absent");
  assert.equal(liveDayState({ ...base, now: at("09:03"), record: null }), "waiting");
});

test("live: a punch at 09:11 is late, and at 10:00 is a half day", () => {
  const rec = (t: string) => ({ status: t === "09:11" ? "late" : "half_day", punchInTime: at(t), punchOutTime: null });
  assert.equal(liveDayState({ ...base, now: at("09:12"), record: rec("09:11") }), "late");
  assert.equal(liveDayState({ ...base, now: at("10:01"), record: rec("10:00") }), "half_day");
});

test("live: a punched-in employee shows the stored status, and leave, off days and future days are classified", () => {
  assert.equal(liveDayState({ ...base, now: at("09:20"), record: { status: "present", punchInTime: at("09:02"), punchOutTime: null } }), "present");
  assert.equal(liveDayState({ ...base, now: at("09:10"), record: null, onLeave: true }), "on_leave");
  assert.equal(liveDayState({ ...base, now: at("09:10"), record: null, offDay: true }), "off");
  assert.equal(liveDayState({ ...base, now: at("09:10"), record: null, workDate: new Date("2026-11-11T00:00:00Z") }), "not_started");
  assert.equal(liveDayState({ ...base, now: at("09:10"), record: null, joinDate: new Date("2026-11-12T00:00:00Z") }), "not_started");
});

test("live: a past day with no punch is absent, and a punch-in with no punch-out on a past day is a half day", () => {
  const past = { ...base, todayLocal: new Date("2026-11-11T00:00:00Z"), now: at("12:00", "2026-11-11") };
  assert.equal(liveDayState({ ...past, record: null }), "absent");
  assert.equal(liveDayState({ ...past, record: { status: "present", punchInTime: at("09:02"), punchOutTime: null } }), "half_day");
});
