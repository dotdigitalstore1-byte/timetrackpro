import assert from "node:assert/strict";
import { test } from "node:test";
import { cyclePeriod, summarizeMonth } from "../src/lib/payroll.ts";

const TODAY = Date.UTC(2026, 10, 17); // 17 Nov 2026, company-local midnight
type Rec = { id: string; status: string; hasPunchIn: boolean; hasPunchOut: boolean; earlyLeaveMinutes: number; overtimeMinutes: number; excused?: boolean };
const day = (d: number) => `2026-11-${String(d).padStart(2, "0")}`;

function run(records: Map<string, Rec>, nowMinutes: number, absentAfterMinutes: number | null = 13 * 60 + 30, approvedLeaves: { start: Date; end: Date }[] = []) {
  return summarizeMonth({
    year: 2026,
    month: 11,
    period: cyclePeriod(2026, 11, 1),
    weeklyOff: new Set([0]),
    records: records as never,
    approvedLeaves,
    todayLocal: new Date(TODAY),
    live: { nowMinutes, absentAfterMinutes },
  });
}

test("full-day counter: a late punch still counts as a full day present", () => {
  const recs = new Map([[day(16), { id: "a", status: "late", hasPunchIn: true, hasPunchOut: true, earlyLeaveMinutes: 0, overtimeMinutes: 0 }]]);
  const s = run(recs, 12 * 60);
  assert.equal(s.presentDays, 1);
  assert.equal(s.lateDays, 1);
});

test("late mark is recorded the same day and its line is flagged as live", () => {
  const recs = new Map([[day(17), { id: "t", status: "late", hasPunchIn: true, hasPunchOut: false, earlyLeaveMinutes: 0, overtimeMinutes: 0 }]]);
  const s = run(recs, 9 * 60 + 10);
  assert.equal(s.lateDays, 1);
  assert.equal(s.events.find((e) => e.lateDay)?.provisional, true);
});

test("half-day punch triggers the half-day deduction immediately", () => {
  const recs = new Map([[day(17), { id: "h", status: "half_day", hasPunchIn: true, hasPunchOut: false, earlyLeaveMinutes: 0, overtimeMinutes: 0 }]]);
  assert.equal(run(recs, 11 * 60).halfDays, 1);
});

const todayAbsent = (s: ReturnType<typeof run>) => s.events.filter((e) => e.absent && e.provisional).length;

test("no punch today: pending until the cut-off, absent the moment it passes", () => {
  assert.equal(todayAbsent(run(new Map(), 13 * 60)), 0, "still inside the allowed window");
  const after = run(new Map(), 13 * 60 + 31);
  assert.equal(todayAbsent(after), 1, "unapproved day counted live, the same day");
  assert.equal(after.events.find((e) => e.absent && e.provisional)?.date.getTime(), TODAY);
});

test("with no cut-off set, the salary code uses the shift end: pending before it, absent after it", () => {
  const shiftEnd = 18 * 60; // what salary.ts passes when the absence cut-off is switched off
  assert.equal(todayAbsent(run(new Map(), 17 * 60, shiftEnd)), 0);
  assert.equal(todayAbsent(run(new Map(), 18 * 60 + 1, shiftEnd)), 1);
});

test("unknown cut-off (null) never turns today into an absence", () => {
  assert.equal(todayAbsent(run(new Map(), 23 * 60, null)), 0);
});

test("an approved leave on a missed day is leave, not an unapproved absence", () => {
  const leave = new Date(Date.UTC(2026, 10, 16));
  const s = run(new Map(), 20 * 60, 13 * 60 + 30, [{ start: leave, end: leave }]);
  assert.equal(s.leaveDays, 1);
  assert.equal(s.events.some((e) => e.absent && e.date.getTime() === Date.UTC(2026, 10, 16)), false, "the 16th is leave, not absence");
  assert.equal(todayAbsent(s), 1);
});

test("an excused late mark is a full day with no late deduction", () => {
  const recs = new Map([[day(16), { id: "x", status: "late", excused: true, hasPunchIn: true, hasPunchOut: true, earlyLeaveMinutes: 0, overtimeMinutes: 0 }]]);
  const s = run(recs, 12 * 60);
  assert.equal(s.presentDays, 1);
  assert.equal(s.lateDays, 0);
  assert.equal(s.events.find((e) => e.excusedLate)?.attendanceId, "x");
});
