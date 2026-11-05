import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeSalary, computeStatus, dateKey, localParts, localWorkDate,
  monthWorkdays, parseWeeklyOff, summarizeMonth,
} from "../src/lib/payroll.ts";

const policy = { shiftStart: "09:00", graceMinutes: 15, lateThresholdMinutes: 45, timezone: "Asia/Kolkata" };

test("status uses company timezone, not UTC", () => {
  // 09:10 IST == 03:40 UTC -> within grace -> present
  assert.equal(computeStatus(new Date("2026-10-05T03:40:00Z"), policy), "present");
  // 09:30 IST == 04:00 UTC -> late
  assert.equal(computeStatus(new Date("2026-10-05T04:00:00Z"), policy), "late");
  // 10:00 IST == 04:30 UTC -> half day
  assert.equal(computeStatus(new Date("2026-10-05T04:30:00Z"), policy), "half_day");
});

test("local work date rolls over at local midnight", () => {
  // 23:00 UTC on the 5th is already the 6th in IST
  assert.equal(dateKey(localWorkDate(new Date("2026-10-05T23:00:00Z"), "Asia/Kolkata")), "2026-10-06");
  assert.equal(localParts(new Date("2026-10-05T23:00:00Z"), "Asia/Kolkata").minutes, 4 * 60 + 30);
});

test("weekly off + workdays", () => {
  const days = monthWorkdays(2026, 10, parseWeeklyOff("0,6"));
  assert.equal(days.length, 22); // Oct 2026 has 22 Mon-Fri days
  assert.equal(monthWorkdays(2026, 10, parseWeeklyOff("0")).length, 27);
});

function mkSummary(over: Partial<ReturnType<typeof summarizeMonth>> = {}) {
  return { presentDays: 0, lateDays: 0, halfDays: 0, leaveDays: 0, absentDays: 0, unapprovedOccurrences: [], ...over };
}
const baseSalary = {
  basicSalary: 26000, workDaysPerMonth: 26,
  lateRule: { type: "fixed" as const, value: 100 },
  halfDayRule: { type: "percentage" as const, value: 50 },
  leaveRule: { type: "percentage" as const, value: 0 },
  holdDaysPerOccurrence: 2, releasedHoldCount: 0, otherDeductions: [],
};

test("perfect month pays full basic", () => {
  const r = computeSalary({ ...baseSalary, summary: mkSummary({ presentDays: 26 }) });
  assert.equal(r.netPayable, 26000);
  assert.equal(r.totalDeductions, 0);
});

test("deductions are not double counted", () => {
  // 1 late day (fixed 100), 1 half day (50% of 1000), 2 paid leave days (0%)
  const r = computeSalary({ ...baseSalary, summary: mkSummary({ presentDays: 22, lateDays: 1, halfDays: 1, leaveDays: 2 }) });
  assert.equal(r.attendanceSalary, 26000);
  assert.equal(r.lateDeduction, 100);
  assert.equal(r.halfDayDeduction, 500);
  assert.equal(r.leaveDeduction, 0);
  assert.equal(r.netPayable, 25400);
});

test("unapproved absence: unpaid day + separate 2-day hold per occurrence", () => {
  const d1 = new Date(Date.UTC(2026, 9, 5)), d2 = new Date(Date.UTC(2026, 9, 14));
  const r = computeSalary({ ...baseSalary, summary: mkSummary({ presentDays: 22, absentDays: 2, unapprovedOccurrences: [d1, d2] }) });
  assert.equal(r.attendanceSalary, 24000); // 2 unpaid days
  assert.equal(r.holdDays, 4);             // 2 occurrences x 2 days
  assert.equal(r.holdAmount, 4000);
  assert.equal(r.totalDeductions, 0);      // holds are NOT deductions
  assert.equal(r.netPayable, 20000);
});

test("released holds are paid back", () => {
  const d1 = new Date(Date.UTC(2026, 9, 5)), d2 = new Date(Date.UTC(2026, 9, 14));
  const r = computeSalary({ ...baseSalary, releasedHoldCount: 1, summary: mkSummary({ absentDays: 2, unapprovedOccurrences: [d1, d2] }) });
  assert.equal(r.holdDays, 2);
  assert.equal(r.netPayable, 24000 - 2000);
});

test("consecutive absences are one occurrence; today/future are not absent", () => {
  const records = new Map();
  const todayLocal = new Date(Date.UTC(2026, 9, 9)); // Fri 9 Oct
  const s = summarizeMonth({
    year: 2026, month: 10, weeklyOff: parseWeeklyOff("0,6"), records, approvedLeaves: [], todayLocal,
  });
  // workdays Oct 1,2,5,6,7,8 are before today and all absent => ONE block
  assert.equal(s.absentDays, 6);
  assert.equal(s.unapprovedOccurrences.length, 1);
});

test("approved leave breaks an absence block", () => {
  const todayLocal = new Date(Date.UTC(2026, 9, 31));
  const s = summarizeMonth({
    year: 2026, month: 10, weeklyOff: parseWeeklyOff("0,6"), records: new Map(),
    approvedLeaves: [{ start: new Date(Date.UTC(2026, 9, 6)), end: new Date(Date.UTC(2026, 9, 6)) }],
    todayLocal,
  });
  assert.equal(s.leaveDays, 1);
  assert.ok(s.unapprovedOccurrences.length >= 2);
});
