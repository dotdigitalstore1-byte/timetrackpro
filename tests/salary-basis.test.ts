import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeSalary,
  cyclePeriod,
  dailyRateDivisor,
  parseWeeklyOff,
  salaryBasisOf,
  SALARY_BASE_DAYS,
} from "../src/lib/payroll.ts";

// Cycle 26 Oct 2026 to 25 Nov 2026: 31 calendar days. Sundays in it: 1, 8, 15 and 22 Nov (4 days).
const OCT_26_NOV_25 = cyclePeriod(2026, 11, 26);
const SUNDAY_OFF = parseWeeklyOff("0");
const NO_OFF = parseWeeklyOff("");

test("the fixed basis always divides by 30, whatever the cycle", () => {
  assert.equal(dailyRateDivisor("fixed", OCT_26_NOV_25, SUNDAY_OFF), 30);
  assert.equal(dailyRateDivisor("fixed", cyclePeriod(2026, 2, 1), SUNDAY_OFF), 30);
});

test("the working basis divides by working days: calendar days minus weekly offs", () => {
  // 31 calendar days, 4 Sundays off, so 27 working days.
  assert.equal(dailyRateDivisor("working", OCT_26_NOV_25, SUNDAY_OFF), 27);
  // Saturday and Sunday are both weekly offs.
  // 4 Saturdays (31 Oct, 7, 14, 21 Nov) and 4 Sundays are off: 31 - 8 = 23.
  assert.equal(dailyRateDivisor("working", OCT_26_NOV_25, parseWeeklyOff("0,6")), 23);
});

test("the calendar basis divides by the actual days in the cycle (28, 30 or 31)", () => {
  assert.equal(dailyRateDivisor("calendar", OCT_26_NOV_25, SUNDAY_OFF), 31);
  assert.equal(dailyRateDivisor("calendar", cyclePeriod(2026, 2, 1), SUNDAY_OFF), 28); // February 2026
  assert.equal(dailyRateDivisor("calendar", cyclePeriod(2026, 4, 1), NO_OFF), 30); // April
});

test("with no weekly offs, the working basis equals the calendar basis", () => {
  assert.equal(dailyRateDivisor("working", OCT_26_NOV_25, NO_OFF), 31);
});

test("a cycle with no working day falls back to the standard 30 instead of dividing by zero", () => {
  const everyDayOff = parseWeeklyOff("0,1,2,3,4,5,6");
  assert.equal(dailyRateDivisor("working", OCT_26_NOV_25, everyDayOff), SALARY_BASE_DAYS);
});

test("an unknown or missing stored basis reads as the standard fixed month", () => {
  assert.equal(salaryBasisOf(undefined), "fixed");
  assert.equal(salaryBasisOf("monthly"), "fixed");
  assert.equal(salaryBasisOf("working"), "working");
  assert.equal(salaryBasisOf("calendar"), "calendar");
});

// ---------------------------------------------------------------- effect on pay

const base = {
  basicSalary: 30000,
  lateRule: { type: "fixed" as const, value: 0 },
  halfDayRule: { type: "percentage" as const, value: 50 },
  leaveRule: { type: "percentage" as const, value: 100 },
  otherDeductions: [],
};
const sum = (over: Record<string, unknown> = {}) => ({
  presentDays: 22, lateDays: 0, halfDays: 0, leaveDays: 0, absentDays: 0,
  unapprovedOccurrences: [], unapprovedRunLengths: [], earlyLeaveDays: 0, overtimeMinutes: 0, events: [], ...over,
});

test("the daily rate follows the chosen basis, and deductions follow the rate", () => {
  const fixed = computeSalary({ ...base, workDaysPerMonth: 30, summary: sum({ absentDays: 1 }) });
  const working = computeSalary({ ...base, workDaysPerMonth: 27, summary: sum({ absentDays: 1 }) });
  const calendar = computeSalary({ ...base, workDaysPerMonth: 31, summary: sum({ absentDays: 1 }) });

  assert.equal(fixed.dailyRate, 1000);
  assert.equal(working.dailyRate, 1111.11);
  assert.equal(calendar.dailyRate, 967.74);

  // One unapproved absence costs one daily rate: higher rate, bigger deduction.
  assert.equal(fixed.attendanceSalary, 29000);
  assert.equal(working.attendanceSalary, 28888.89);
  assert.equal(calendar.attendanceSalary, 29032.26);
  assert.equal(working.dailyRateDivisor, 27);
});

test("the working basis raises the half-day and leave deductions, and the holiday cut", () => {
  const working = computeSalary({
    ...base,
    workDaysPerMonth: 27,
    summary: sum({ halfDays: 1, leaveDays: 1 }),
    holidayDeductionDays: 1,
  });
  // Half day: 50% of 1111.11 = 555.56. Leave: 100% of 1111.11. Holiday cut: one daily rate.
  assert.equal(working.halfDayDeduction, 555.56);
  assert.equal(working.leaveDeduction, 1111.11);
  assert.equal(working.holidayDeduction, 1111.11);
});

test("the overtime hourly rate is based on the same daily rate", () => {
  const working = computeSalary({
    ...base,
    workDaysPerMonth: 27,
    shiftHours: 9,
    overtime: { rate: 1 },
    summary: sum({ overtimeMinutes: 60 }),
  });
  // Hourly = 1111.11 / 9 = 123.46 for one hour at 1x.
  assert.equal(working.overtimePay, 123.46);
});

test("the fixed basis output is unchanged from the previous behaviour", () => {
  const fixed = computeSalary({ ...base, workDaysPerMonth: 30, summary: sum({ absentDays: 2, halfDays: 2 }) });
  assert.equal(fixed.dailyRate, 1000);
  assert.equal(fixed.netPayable, 27000); // 30,000 - 2 absent days - 2 half days at 500
});
