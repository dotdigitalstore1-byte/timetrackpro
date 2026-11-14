import assert from "node:assert/strict";
import { test } from "node:test";
import { computeSalary, dateKey, parseWeeklyOff, SALARY_BASE_DAYS, summarizeMonth } from "../src/lib/payroll.ts";

// October 2026: Sundays are the 4th, 11th, 18th and 25th.
const OFF = parseWeeklyOff("0,6");
const TODAY = new Date(Date.UTC(2026, 10, 25));

const base = {
  basicSalary: 30000,
  workDaysPerMonth: SALARY_BASE_DAYS,
  lateRule: { type: "fixed" as const, value: 0 },
  halfDayRule: { type: "percentage" as const, value: 50 },
  leaveRule: { type: "percentage" as const, value: 100 }, // an unpaid leave day costs a full day
  otherDeductions: [],
};
const sum = (over: Record<string, unknown> = {}) => ({
  presentDays: 22, lateDays: 0, halfDays: 0, leaveDays: 0, absentDays: 0,
  unapprovedOccurrences: [], unapprovedRunLengths: [], earlyLeaveDays: 0, overtimeMinutes: 0, events: [], ...over,
});

test("standard month is 30 days: daily rate is basic / 30 for every calendar length", () => {
  const r = computeSalary({ ...base, summary: sum() });
  assert.equal(r.dailyRate, 1000); // 30,000 / 30
  assert.equal(r.netPayable, 30000);
  // an invalid divisor falls back to the standard 30
  assert.equal(computeSalary({ ...base, workDaysPerMonth: 0, summary: sum() }).dailyRate, 1000);
});

test("each unpaid leave day deducts one daily rate from the 30-day base", () => {
  const r = computeSalary({ ...base, summary: sum({ leaveDays: 2 }) });
  assert.equal(r.compOffUsed, 0);
  assert.equal(r.unpaidLeaveDays, 2);
  assert.equal(r.leaveDeduction, 2000);
  assert.equal(r.netPayable, 28000);
});

test("a Sunday worked in the same cycle pays for one leave day", () => {
  const r = computeSalary({ ...base, summary: sum({ leaveDays: 1, weekOffWorkedDays: 1 }) });
  assert.equal(r.compOffUsed, 1);
  assert.equal(r.unpaidLeaveDays, 0);
  assert.equal(r.leaveDeduction, 0);
  assert.equal(r.compOffUnused, 0);
  assert.equal(r.netPayable, 30000);
});

test("a Sunday worked with no leave lapses when extra pay is off", () => {
  const r = computeSalary({ ...base, extraPay: { enabled: false, rate: 1 }, summary: sum({ weekOffWorkedDays: 1 }) });
  assert.equal(r.compOffUnused, 1);
  assert.equal(r.extraPayDays, 0);
  assert.equal(r.extraPay, 0);
  assert.equal(r.netPayable, 30000);
});

test("unused comp-off is paid as extra pay when enabled", () => {
  const r = computeSalary({ ...base, extraPay: { enabled: true, rate: 1 }, summary: sum({ weekOffWorkedDays: 1 }) });
  assert.equal(r.extraPayDays, 1);
  assert.equal(r.extraPay, 1000);
  assert.equal(r.netPayable, 31000);
});

test("extra pay rate is a multiplier of the daily rate", () => {
  const r = computeSalary({ ...base, extraPay: { enabled: true, rate: 1.5 }, summary: sum({ weekOffWorkedDays: 1 }) });
  assert.equal(r.extraPay, 1500);
});

test("two Sundays and one leave: one leave is covered, one comp-off is paid as extra", () => {
  const r = computeSalary({
    ...base, extraPay: { enabled: true, rate: 1 },
    summary: sum({ leaveDays: 1, weekOffWorkedDays: 2 }),
  });
  assert.equal(r.compOffUsed, 1);
  assert.equal(r.compOffUnused, 1);
  assert.equal(r.leaveDeduction, 0);
  assert.equal(r.extraPay, 1000);
  assert.equal(r.netPayable, 31000);
});

test("more leave than Sundays worked: only the extra leave is deducted", () => {
  const r = computeSalary({ ...base, summary: sum({ leaveDays: 3, weekOffWorkedDays: 1 }) });
  assert.equal(r.compOffUsed, 1);
  assert.equal(r.unpaidLeaveDays, 2);
  assert.equal(r.leaveDeduction, 2000);
  assert.equal(r.netPayable, 28000);
});

test("summarizeMonth counts only punched-in weekly-off days as comp-off credits", () => {
  const records = new Map([
    ["2026-10-04", { status: "present", hasPunchIn: true }], // Sunday, worked
    ["2026-10-05", { status: "present", hasPunchIn: true }], // Monday, a normal workday
  ]);
  const s = summarizeMonth({
    year: 2026, month: 10, weeklyOff: OFF, records, approvedLeaves: [], todayLocal: TODAY,
  });
  assert.equal(s.weekOffWorkedDays, 1);
  assert.equal(dateKey(new Date(Date.UTC(2026, 9, 4))), "2026-10-04");
});
