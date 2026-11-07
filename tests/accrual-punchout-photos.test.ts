import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeSalary,
  effectiveStatus,
  leaveCredits,
  parseWeeklyOff,
  photoCutoff,
  PHOTO_RETENTION_DAYS,
  SALARY_BASE_DAYS,
  summarizeMonth,
  type DayRecord,
} from "../src/lib/payroll.ts";

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
const OFF = parseWeeklyOff("0,6");

// ---------------------------------------------------------- mandatory punch-out

test("punched in, never punched out, day is over => half day (not a present day)", () => {
  const records = new Map<string, DayRecord>([
    ["2026-10-05", { status: "present", hasPunchIn: true, hasPunchOut: false }],
  ]);
  const s = summarizeMonth({
    year: 2026, month: 10, weeklyOff: OFF, records, approvedLeaves: [], todayLocal: d(2026, 10, 25),
  });
  assert.equal(s.halfDays, 1);
  assert.equal(s.presentDays, 0);
});

test("today's open punch is not penalised until the day ends", () => {
  const records = new Map<string, DayRecord>([
    ["2026-10-25", { status: "present", hasPunchIn: true, hasPunchOut: false }],
  ]);
  const s = summarizeMonth({
    year: 2026, month: 10, weeklyOff: OFF, records, approvedLeaves: [], todayLocal: d(2026, 10, 25),
  });
  assert.equal(s.halfDays, 0);
  assert.equal(s.presentDays, 0);
});

test("a completed punch pair is unaffected by the new rule", () => {
  const records = new Map<string, DayRecord>([
    ["2026-10-05", { status: "present", hasPunchIn: true, hasPunchOut: true, earlyLeaveMinutes: 0, overtimeMinutes: 0 }],
  ]);
  const s = summarizeMonth({
    year: 2026, month: 10, weeklyOff: OFF, records, approvedLeaves: [], todayLocal: d(2026, 10, 25),
  });
  assert.equal(s.presentDays, 1);
  assert.equal(s.halfDays, 0);
});

test("effectiveStatus flags only past days with a missing punch-out", () => {
  const today = d(2026, 10, 25);
  assert.equal(effectiveStatus({ status: "present", hasPunchIn: true, hasPunchOut: false }, d(2026, 10, 24), today), "half_day");
  assert.equal(effectiveStatus({ status: "present", hasPunchIn: true, hasPunchOut: false }, today, today), "present");
  assert.equal(effectiveStatus({ status: "late", hasPunchIn: true, hasPunchOut: true }, d(2026, 10, 24), today), "late");
});

// ------------------------------------------------------------ leave accrual

test("joining in November shows one leave, not twelve", () => {
  const c = leaveCredits({ joinDate: d(2026, 11, 3), today: d(2026, 11, 7), annualCap: 12 });
  assert.equal(c.accrued, 1);
  assert.equal(c.thisMonth, 1);
});

test("accrual grows by one per month from the joining month", () => {
  const join = d(2026, 3, 10);
  assert.equal(leaveCredits({ joinDate: join, today: d(2026, 3, 31), annualCap: 12 }).accrued, 1);
  assert.equal(leaveCredits({ joinDate: join, today: d(2026, 6, 1), annualCap: 12 }).accrued, 4);
  assert.equal(leaveCredits({ joinDate: join, today: d(2026, 12, 31), annualCap: 12 }).accrued, 10);
});

test("accrual is capped at the annual maximum and starts January for earlier joiners", () => {
  assert.equal(leaveCredits({ joinDate: d(2024, 5, 1), today: d(2026, 11, 7), annualCap: 12 }).accrued, 11);
  assert.equal(leaveCredits({ joinDate: d(2020, 1, 1), today: d(2026, 11, 7), annualCap: 12 }).accrued, 11);
  assert.equal(leaveCredits({ joinDate: d(2020, 1, 1), today: d(2026, 12, 31), annualCap: 12 }).accrued, 12);
  assert.equal(leaveCredits({ joinDate: d(2020, 1, 1), today: d(2026, 12, 31), annualCap: 6 }).accrued, 6);
});

test("someone who has not joined yet has no leave", () => {
  const c = leaveCredits({ joinDate: d(2026, 12, 1), today: d(2026, 11, 7), annualCap: 12 });
  assert.deepEqual(c, { accrued: 0, thisMonth: 0 });
});

// ------------------------------------------------------------ photo retention

test("photos are kept for 45 days and the cutoff is exact", () => {
  assert.equal(PHOTO_RETENTION_DAYS, 45);
  const today = d(2026, 11, 7);
  const cutoff = photoCutoff(today);
  assert.equal(cutoff.toISOString().slice(0, 10), "2026-09-23");
  // 45 days old is still kept (work date == cutoff); 46 days old is due for deletion
  assert.ok(cutoff.getTime() === d(2026, 9, 23).getTime());
  assert.ok(d(2026, 9, 22).getTime() < cutoff.getTime());
});

// ----------------------------------------------------- mandatory punch-out in pay

test("a missed punch-out costs the half-day deduction, not a full day", () => {
  const records = new Map<string, DayRecord>([
    ["2026-10-05", { status: "present", hasPunchIn: true, hasPunchOut: false }],
  ]);
  const summary = summarizeMonth({
    year: 2026, month: 10, weeklyOff: OFF, records, approvedLeaves: [], todayLocal: d(2026, 10, 25),
  });
  const r = computeSalary({
    basicSalary: 30000,
    workDaysPerMonth: SALARY_BASE_DAYS,
    summary,
    lateRule: { type: "fixed", value: 0 },
    halfDayRule: { type: "percentage", value: 50 },
    leaveRule: { type: "percentage", value: 100 },
    holdDaysPerOccurrence: 2,
    releasedHoldCount: 0,
    otherDeductions: [],
  });
  assert.equal(summary.halfDays, 1);
  assert.equal(r.halfDayDeduction, 500); // 50% of a 1,000 daily rate
});

// ------------------------------------------------- half-day counting (regression)

test("two half days, one on a Sunday and one on a weekday, both deduct (2 x 250 = 500)", () => {
  const records = new Map<string, DayRecord>([
    ["2026-10-07", { status: "half_day", hasPunchIn: true, hasPunchOut: true, earlyLeaveMinutes: 0, overtimeMinutes: 0 }], // Wednesday
    ["2026-10-11", { status: "half_day", hasPunchIn: true, hasPunchOut: true, earlyLeaveMinutes: 0, overtimeMinutes: 0 }], // Sunday
  ]);
  const s = summarizeMonth({
    year: 2026, month: 10, weeklyOff: OFF, records, approvedLeaves: [], todayLocal: d(2026, 11, 7),
  });
  assert.equal(s.halfDays, 2);
  assert.equal(s.presentDays, 0);
  const r = computeSalary({
    basicSalary: 15000,
    workDaysPerMonth: SALARY_BASE_DAYS,
    summary: s,
    lateRule: { type: "fixed", value: 0 },
    halfDayRule: { type: "percentage", value: 50 },
    leaveRule: { type: "percentage", value: 100 },
    holdDaysPerOccurrence: 2,
    releasedHoldCount: 0,
    otherDeductions: [],
  });
  assert.equal(r.halfDayDeduction, 500);
});

test("a half day entered without punches is a half day, not an absence", () => {
  const records = new Map<string, DayRecord>([
    ["2026-10-07", { status: "half_day", hasPunchIn: false, hasPunchOut: false }],
  ]);
  const s = summarizeMonth({
    year: 2026, month: 10, weeklyOff: OFF, records, approvedLeaves: [], todayLocal: d(2026, 11, 7),
  });
  assert.equal(s.halfDays, 1);
  // the same day must not also be counted as absent
  const others = s.absentDays;
  const without = summarizeMonth({
    year: 2026, month: 10, weeklyOff: OFF, records: new Map(), approvedLeaves: [], todayLocal: d(2026, 11, 7),
  });
  assert.equal(without.absentDays - others, 1);
});

