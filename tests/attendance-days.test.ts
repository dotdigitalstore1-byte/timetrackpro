import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarDays, weekdayOf } from "../src/lib/attendance-days.ts";
import { cycleCounts, statusLabel, sumCycleCounts, EMPTY_CYCLE_COUNTS } from "../src/lib/attendance-stats.ts";
import { cyclePeriod, summarizeMonth, type DayRecord } from "../src/lib/payroll.ts";

// November 2026, calendar cycle. 1 Nov 2026 is a Sunday; 11 Nov 2026 is "today".
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const period = cyclePeriod(2026, 11, 1);
const today = utc(2026, 11, 11);
const weeklyOff = new Set([0]); // Sunday

function scenario(extra: Partial<Parameters<typeof calendarDays>[0]> = {}) {
  return calendarDays({
    period,
    todayLocal: today,
    weeklyOff,
    holidays: new Set(["2026-11-09"]),
    recordDates: new Set(["2026-11-02", "2026-11-03", "2026-11-04"]),
    approvedLeaves: [{ start: utc(2026, 11, 5), end: utc(2026, 11, 6) }],
    joinDate: null,
    ...extra,
  });
}

test("the list covers every calendar date of the cycle, latest first, with no gaps", () => {
  const list = scenario();
  assert.equal(list.length, 30);
  assert.equal(list[0].date, "2026-11-30");
  assert.equal(list[list.length - 1].date, "2026-11-01");
  for (let i = 1; i < list.length; i++) {
    const prev = Date.parse(`${list[i - 1].date}T00:00:00Z`);
    const cur = Date.parse(`${list[i].date}T00:00:00Z`);
    assert.equal(prev - cur, 86400000, `gap between ${list[i].date} and ${list[i - 1].date}`);
  }
});

test("days with no punch show their status on the date (the missing 8th, 9th and 10th case)", () => {
  const byDate = new Map(scenario().map((d) => [d.date, d]));
  assert.equal(byDate.get("2026-11-08")?.label, "Sunday"); // weekly off
  assert.equal(byDate.get("2026-11-09")?.label, "Holiday"); // company holiday beats the weekday name
  assert.equal(byDate.get("2026-11-10")?.label, "Absent"); // past working day, nothing recorded
  assert.equal(byDate.get("2026-11-05")?.label, "Leave"); // approved leave
  assert.equal(byDate.get("2026-11-06")?.label, "Leave");
  assert.equal(byDate.get("2026-11-11")?.label, "Not punched in"); // today is not absent yet
  assert.equal(byDate.get("2026-11-12")?.label, "Upcoming");
  assert.equal(byDate.get("2026-11-02")?.kind, "record"); // stored records are marked, not overwritten
});

test("weekday names are correct for the dates shown", () => {
  assert.equal(weekdayOf("2026-11-11"), "Wednesday");
  assert.equal(weekdayOf("2026-11-08"), "Sunday");
  assert.equal(weekdayOf("2026-11-01"), "Sunday");
});

test("dates before the join date are not listed", () => {
  const list = scenario({ joinDate: utc(2026, 11, 5) });
  assert.equal(list[list.length - 1].date, "2026-11-05");
  assert.equal(list.length, 26);
});

test("the list agrees with payroll: leave days and absent days are the same as summarizeMonth counts", () => {
  const records = new Map<string, DayRecord>([
    ["2026-11-02", { status: "present", hasPunchIn: true, hasPunchOut: true }],
    ["2026-11-03", { status: "late", hasPunchIn: true, hasPunchOut: true }],
    ["2026-11-04", { status: "half_day", hasPunchIn: true, hasPunchOut: true }],
  ]);
  const leaves = [{ start: utc(2026, 11, 5), end: utc(2026, 11, 6) }];
  const list = scenario();
  const sum = summarizeMonth({
    year: 2026,
    month: 11,
    period,
    weeklyOff,
    holidays: new Set(["2026-11-09"]),
    records,
    approvedLeaves: leaves,
    todayLocal: today,
  });
  const kinds = list.map((d) => d.kind);
  assert.equal(kinds.filter((k) => k === "leave").length, sum.leaveDays);
  assert.equal(kinds.filter((k) => k === "absent").length, sum.absentDays);
  // Nov 7 (Saturday) and Nov 10 are the two past working days with nothing recorded.
  assert.deepEqual(
    list.filter((d) => d.kind === "absent").map((d) => d.date).sort(),
    ["2026-11-07", "2026-11-10"]
  );
});

test("tile counts come from payroll's summary: present excludes late, leaves are leave days", () => {
  const c = cycleCounts({ presentDays: 10, lateDays: 3, halfDays: 2, leaveDays: 4, absentDays: 1 });
  assert.deepEqual(c, { present: 7, late: 3, half: 2, leave: 4, absent: 1 });
});

test("the all-employees view adds each employee's counts together", () => {
  const total = sumCycleCounts([
    { present: 2, late: 1, half: 0, leave: 1, absent: 0 },
    { present: 5, late: 0, half: 1, leave: 0, absent: 2 },
  ]);
  assert.deepEqual(total, { present: 7, late: 1, half: 1, leave: 1, absent: 2 });
  assert.deepEqual(sumCycleCounts([]), EMPTY_CYCLE_COUNTS);
});

test("status labels use the same wording on both pages", () => {
  assert.equal(statusLabel("present"), "On time");
  assert.equal(statusLabel("late"), "Late");
  assert.equal(statusLabel("half_day"), "Half day");
  assert.equal(statusLabel("absent"), "Absent");
});

test("a forgotten Saturday off: past Saturdays show Absent until they are made paid holidays", () => {
  // 7 and 14 Nov 2026 are Saturdays. Saturday is NOT a weekly off here.
  const before = new Map(scenario().map((d) => [d.date, d]));
  assert.equal(before.get("2026-11-07")?.kind, "absent");
  assert.equal(before.get("2026-11-14")?.kind, "upcoming"); // after "today" (11 Nov)

  const after = new Map(scenario({ holidays: new Set(["2026-11-09", "2026-11-07", "2026-11-14"]) }).map((d) => [d.date, d]));
  assert.equal(after.get("2026-11-07")?.kind, "off");
  assert.equal(after.get("2026-11-07")?.label, "Holiday");
  assert.equal(after.get("2026-11-14")?.kind, "off");
});
