import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampCycleStartDay, computeSalary, computeStatus, currentCycleKey, cyclePeriod, dateKey,
  earlyLeaveMinutesOf, isValidHHMM, localWorkDate, overtimeMinutesOf, parseWeeklyOff,
  shiftHours, summarizeMonth,
} from "../src/lib/payroll.ts";

const TZ = "Asia/Kolkata"; // UTC+5:30
const at = (hhmm: string, day = "2026-10-05") => new Date(`${day}T${hhmm}:00+05:30`);

// ---------------------------------------------------------------- cool-off (grace)
test("5-minute cool-off: 9:04 on a 9:00 shift is still a full day", () => {
  const policy = { shiftStart: "09:00", graceMinutes: 5, lateThresholdMinutes: 30, timezone: TZ };
  assert.equal(computeStatus(at("09:00"), policy), "present");
  assert.equal(computeStatus(at("09:04"), policy), "present"); // the example from the brief
  assert.equal(computeStatus(at("09:05"), policy), "present"); // boundary is inclusive
  assert.equal(computeStatus(at("09:06"), policy), "late");
  assert.equal(computeStatus(at("09:30"), policy), "late");
  assert.equal(computeStatus(at("09:31"), policy), "half_day");
});

test("a per-employee shift moves the cool-off window with it", () => {
  const night = { shiftStart: "14:00", graceMinutes: 5, lateThresholdMinutes: 30, timezone: TZ };
  assert.equal(computeStatus(at("14:04"), night), "present");
  assert.equal(computeStatus(at("14:10"), night), "late");
  // the same 14:04 punch would be a half-day for someone on a 09:00 shift
  assert.equal(computeStatus(at("14:04"), { ...night, shiftStart: "09:00" }), "half_day");
});

test("validators and shift length", () => {
  assert.equal(isValidHHMM("09:00"), true);
  assert.equal(isValidHHMM("9:00"), false);
  assert.equal(isValidHHMM("24:00"), false);
  assert.equal(isValidHHMM("12:60"), false);
  assert.equal(shiftHours("09:00", "17:00"), 8);
  assert.equal(shiftHours("09:30", "18:00"), 8.5);
  assert.equal(shiftHours("22:00", "06:00"), 8); // overnight range falls back to 8
});

// -------------------------------------------------------- early leave / overtime
test("early leave and overtime minutes are measured against shift end", () => {
  const wd = localWorkDate(at("17:00"), TZ);
  assert.equal(earlyLeaveMinutesOf(at("16:55"), wd, "17:00", TZ), 5);
  assert.equal(earlyLeaveMinutesOf(at("17:00"), wd, "17:00", TZ), 0);
  assert.equal(earlyLeaveMinutesOf(at("18:10"), wd, "17:00", TZ), 0);
  assert.equal(overtimeMinutesOf(at("18:10"), wd, "17:00", TZ), 70);
  assert.equal(overtimeMinutesOf(at("16:00"), wd, "17:00", TZ), 0);
});

test("punching out after midnight counts as overtime, not early leave", () => {
  const wd = localWorkDate(at("17:00", "2026-10-05"), TZ);
  const out = at("00:30", "2026-10-06"); // next calendar day
  assert.equal(earlyLeaveMinutesOf(out, wd, "17:00", TZ), 0);
  assert.equal(overtimeMinutesOf(out, wd, "17:00", TZ), 450);
});

// ------------------------------------------------------------------ salary cycle
test("cycle start day 1 is the calendar month", () => {
  const p = cyclePeriod(2026, 11, 1);
  assert.equal(dateKey(p.start), "2026-11-01");
  assert.equal(dateKey(p.end), "2026-11-30");
  const feb = cyclePeriod(2028, 2, 1);
  assert.equal(dateKey(feb.end), "2028-02-29"); // leap year
});

test("cycle start day 26 runs 26th of last month to 25th, named by the end month", () => {
  const p = cyclePeriod(2026, 11, 26);
  assert.equal(dateKey(p.start), "2026-10-26");
  assert.equal(dateKey(p.end), "2026-11-25");
  const jan = cyclePeriod(2027, 1, 26); // crosses the year boundary
  assert.equal(dateKey(jan.start), "2026-12-26");
  assert.equal(dateKey(jan.end), "2027-01-25");
});

test("consecutive cycles never overlap or leave a gap", () => {
  for (const sd of [1, 5, 15, 26, 28]) {
    for (let m = 1; m < 12; m++) {
      const a = cyclePeriod(2026, m, sd);
      const b = cyclePeriod(2026, m + 1, sd);
      assert.equal(b.start.getTime() - a.end.getTime(), 86400000, `startDay ${sd} month ${m}`);
    }
  }
});

test("which cycle is 'current' depends on the start day", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  assert.deepEqual(currentCycleKey(d("2026-11-10"), 1), { year: 2026, month: 11 });
  assert.deepEqual(currentCycleKey(d("2026-10-25"), 26), { year: 2026, month: 10 });
  assert.deepEqual(currentCycleKey(d("2026-10-26"), 26), { year: 2026, month: 11 });
  assert.deepEqual(currentCycleKey(d("2026-12-30"), 26), { year: 2027, month: 1 });
});

test("start day is clamped to 1..28", () => {
  assert.equal(clampCycleStartDay(0), 1);
  assert.equal(clampCycleStartDay(31), 28);
  assert.equal(clampCycleStartDay("abc"), 1);
  assert.equal(clampCycleStartDay(26.4), 26);
});

test("summarizeMonth honours a custom pay period", () => {
  // cycle 26 Oct - 25 Nov 2026, weekly off Sat/Sun, today = 25 Nov
  const records = new Map();
  const s = summarizeMonth({
    year: 2026, month: 11, period: cyclePeriod(2026, 11, 26), weeklyOff: parseWeeklyOff("0,6"),
    records, approvedLeaves: [], todayLocal: new Date(Date.UTC(2026, 10, 25)),
  });
  // 26 Oct..24 Nov = 5+5+5+5+2 = 22 weekdays (25 Nov is "today": not absent yet)
  assert.equal(s.absentDays, 22);
});

// ---------------------------------------------------- rules inside the summary
const baseRecordArgs = {
  year: 2026, month: 10, weeklyOff: parseWeeklyOff("0,6"), approvedLeaves: [],
  todayLocal: new Date(Date.UTC(2026, 9, 31)),
};

test("early leave beyond grace is flagged; within grace is ignored", () => {
  const records = new Map([
    ["2026-10-01", { status: "present", hasPunchIn: true, earlyLeaveMinutes: 4 }],  // within 5 min grace
    ["2026-10-02", { status: "present", hasPunchIn: true, earlyLeaveMinutes: 20 }], // beyond grace
  ]);
  const s = summarizeMonth({ ...baseRecordArgs, records, rules: { earlyLeaveGraceMinutes: 5, earlyLeaveHalfDayMinutes: 0 } });
  assert.equal(s.earlyLeaveDays, 1);
  assert.equal(s.presentDays, 2);
});

test("leaving far too early downgrades the day to a half day (and is not double counted)", () => {
  const records = new Map([
    ["2026-10-01", { status: "late", hasPunchIn: true, earlyLeaveMinutes: 200 }],
  ]);
  const s = summarizeMonth({ ...baseRecordArgs, records, rules: { earlyLeaveGraceMinutes: 5, earlyLeaveHalfDayMinutes: 120 } });
  assert.equal(s.halfDays, 1);
  assert.equal(s.presentDays, 0);
  assert.equal(s.lateDays, 0);
  assert.equal(s.earlyLeaveDays, 0);
});

test("without rules the summary behaves exactly as before", () => {
  const records = new Map([["2026-10-01", { status: "present", hasPunchIn: true, earlyLeaveMinutes: 300 }]]);
  const s = summarizeMonth({ ...baseRecordArgs, records });
  assert.equal(s.presentDays, 1);
  assert.equal(s.halfDays, 0);
  assert.equal(s.earlyLeaveDays, 0);
});

test("overtime needs the minimum, is capped per day, and sums", () => {
  const records = new Map([
    ["2026-10-01", { status: "present", hasPunchIn: true, overtimeMinutes: 20 }],  // below min -> ignored
    ["2026-10-02", { status: "present", hasPunchIn: true, overtimeMinutes: 90 }],  // counts
    ["2026-10-05", { status: "present", hasPunchIn: true, overtimeMinutes: 400 }], // capped at 240
  ]);
  const s = summarizeMonth({
    ...baseRecordArgs, records,
    rules: { earlyLeaveGraceMinutes: 5, earlyLeaveHalfDayMinutes: 0, overtime: { minMinutes: 30, maxMinutesPerDay: 240 } },
  });
  assert.equal(s.overtimeMinutes, 90 + 240);
});

// --------------------------------------------------------------- salary maths
const sum = (over = {}) => ({
  presentDays: 26, lateDays: 0, halfDays: 0, leaveDays: 0, absentDays: 0,
  unapprovedOccurrences: [], unapprovedRunLengths: [], earlyLeaveDays: 0, overtimeMinutes: 0, events: [], ...over,
});
const base = {
  basicSalary: 26000, workDaysPerMonth: 26,
  lateRule: { type: "fixed" as const, value: 0 },
  halfDayRule: { type: "percentage" as const, value: 50 },
  leaveRule: { type: "percentage" as const, value: 0 },
  otherDeductions: [],
};

test("late-marks rule: every 3 late days cost half a day", () => {
  const rule = { limit: 3, penaltyDays: 0.5 };
  assert.equal(computeSalary({ ...base, lateMarks: rule, summary: sum({ lateDays: 2 }) }).lateMarksDeduction, 0);
  assert.equal(computeSalary({ ...base, lateMarks: rule, summary: sum({ lateDays: 3 }) }).lateMarksDeduction, 500);
  const r = computeSalary({ ...base, lateMarks: rule, summary: sum({ lateDays: 7 }) }); // 2 full groups
  assert.equal(r.lateMarksDeduction, 1000);
  assert.equal(r.totalDeductions, 1000);
  assert.equal(r.netPayable, 25000);
  assert.equal(computeSalary({ ...base, lateMarks: { limit: 0, penaltyDays: 1 }, summary: sum({ lateDays: 9 }) }).lateMarksDeduction, 0);
});

test("early-leave deduction is per early-leave day", () => {
  const r = computeSalary({
    ...base, earlyLeaveRule: { type: "percentage", value: 25 }, summary: sum({ earlyLeaveDays: 2 }),
  });
  assert.equal(r.earlyLeaveDeduction, 500); // 25% of 1000 x 2
  assert.equal(r.netPayable, 25500);
});

test("overtime pays by the hour at the multiplier and is added to net", () => {
  // daily rate 1000, 8h shift => 125/h; 3h x 1.5 = 562.5
  const r = computeSalary({ ...base, shiftHours: 8, overtime: { rate: 1.5 }, summary: sum({ overtimeMinutes: 180 }) });
  assert.equal(r.overtimePay, 562.5);
  assert.equal(r.netPayable, 26562.5);
});

test("additions (bonus) raise net; deductions still apply; nothing negative", () => {
  const r = computeSalary({ ...base, additions: [{ label: "Diwali bonus", amount: 2000 }], summary: sum() });
  assert.equal(r.additionsTotal, 2000);
  assert.equal(r.netPayable, 28000);
  const lowPay = computeSalary({ ...base, basicSalary: 1000, otherDeductions: [{ label: "Advance", amount: 5000 }], summary: sum() });
  assert.equal(lowPay.netPayable, 0);
});

test("rules default off: old inputs give identical results", () => {
  const r = computeSalary({ ...base, summary: sum({ presentDays: 22, lateDays: 1, halfDays: 1 }) });
  assert.equal(r.lateMarksDeduction, 0);
  assert.equal(r.earlyLeaveDeduction, 0);
  assert.equal(r.overtimePay, 0);
  assert.equal(r.additionsTotal, 0);
});
