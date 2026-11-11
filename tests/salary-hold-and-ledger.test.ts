import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays, buildDeductionLedger, computeSalary, cyclePeriod, dateKey, holdDelayDaysOf,
  holidayDeductionBlocks, salaryDateOf, summarizeMonth, type DayRecord, type LedgerEntry,
} from "../src/lib/payroll.ts";

const NOV = cyclePeriod(2026, 11, 1);
const WEEKEND = new Set([0, 6]);
const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const TODAY = utc("2026-11-17"); // days from the 17th on are not yet unapproved

// November 2026: the 1st is a Sunday. Workdays are Mon–Fri.
function november() {
  const records = new Map<string, DayRecord>([
    ["2026-11-02", { status: "present", hasPunchIn: true, hasPunchOut: true, punchInMinutes: 540, punchOutMinutes: 1080 }],
    ["2026-11-03", { status: "late", hasPunchIn: true, hasPunchOut: true, punchInMinutes: 565, punchOutMinutes: 1080 }],
    ["2026-11-04", { status: "half_day", hasPunchIn: true, hasPunchOut: true, punchInMinutes: 630, punchOutMinutes: 1080 }],
    ["2026-11-05", { status: "present", hasPunchIn: true, hasPunchOut: true, punchInMinutes: 540, punchOutMinutes: 1020, earlyLeaveMinutes: 60 }],
    ["2026-11-08", { status: "present", hasPunchIn: true, hasPunchOut: true, punchInMinutes: 600, punchOutMinutes: 960 }], // Sunday worked
    ["2026-11-11", { status: "late", hasPunchIn: true, hasPunchOut: true, punchInMinutes: 565, punchOutMinutes: 1080 }],
    ["2026-11-12", { status: "half_day", hasPunchIn: false, hasPunchOut: false }], // entered by admin
    ["2026-11-13", { status: "absent", hasPunchIn: true, hasPunchOut: false, punchInMinutes: 840 }], // after the cut-off
  ]);
  const approvedLeaves = [{ start: utc("2026-11-09"), end: utc("2026-11-10") }];
  const summary = summarizeMonth({
    year: 2026, month: 11, period: NOV,
    rules: { earlyLeaveGraceMinutes: 5, earlyLeaveHalfDayMinutes: 0 },
    weeklyOff: WEEKEND, records, approvedLeaves, todayLocal: TODAY,
  });
  const ctx = {
    weeklyOff: WEEKEND, holidays: new Set<string>(), records, approvedLeaves, todayLocal: TODAY, joinDate: null,
    loadedStart: utc("2026-10-25"), loadedEnd: utc("2026-12-08"),
  };
  const holidayBlocks = holidayDeductionBlocks(NOV, ctx, 2);
  return { summary, holidayBlocks };
}

const rules = {
  basicSalary: 30000,
  workDaysPerMonth: 30,
  lateRule: { type: "fixed" as const, value: 100 },
  halfDayRule: { type: "fixed" as const, value: 500 },
  leaveRule: { type: "percentage" as const, value: 100 },
  earlyLeaveRule: { type: "fixed" as const, value: 50 },
  lateMarks: { limit: 2, penaltyDays: 0.5 },
  otherDeductions: [{ label: "Advance recovery", amount: 300 }],
};

test("salary date is the chosen day of the month after the cycle ends", () => {
  assert.equal(dateKey(salaryDateOf(2026, 11, 5)), "2026-12-05"); // Nov cycle, paid on the 5th of December
  assert.equal(dateKey(salaryDateOf(2026, 12, 3)), "2027-01-03"); // rolls over the year
  assert.equal(dateKey(salaryDateOf(2026, 11, 1)), "2026-12-01");
  assert.equal(dateKey(salaryDateOf(2026, 11, 0)), "2026-12-05"); // unset or invalid: the default 5th
  assert.equal(dateKey(salaryDateOf(2026, 11, 40)), "2026-12-28"); // clamped to 28
});

test("disbursement = salary date + hold delay; 1 unapproved day = 2 days, 2 = 4, 3 = 6", () => {
  const salaryDate = salaryDateOf(2026, 11, 5);
  assert.equal(dateKey(addDays(salaryDate, holdDelayDaysOf([{ unapprovedDays: 1, released: false }], 2, true))), "2026-12-07");
  assert.equal(dateKey(addDays(salaryDate, holdDelayDaysOf([{ unapprovedDays: 2, released: false }], 2, true))), "2026-12-09");
  assert.equal(dateKey(addDays(salaryDate, holdDelayDaysOf([{ unapprovedDays: 3, released: false }], 2, true))), "2026-12-11");
  // rule switched off: paid on the salary date
  assert.equal(dateKey(addDays(salaryDate, holdDelayDaysOf([{ unapprovedDays: 3, released: false }], 2, false))), "2026-12-05");
});

test("a November with unapproved days: the run lengths count every unapproved day", () => {
  const { summary } = november();
  // Fri 6 Nov is one run; Fri 13 and Mon 16 are consecutive workdays (the weekend does not break a run).
  assert.deepEqual(summary.unapprovedRunLengths, [1, 2]);
  assert.equal(summary.absentDays, 3);
  assert.equal(summary.leaveDays, 2);
  assert.equal(summary.weekOffWorkedDays, 1);
});

test("the day-wise log adds up to the totals: absent days + total deductions", () => {
  const { summary, holidayBlocks } = november();
  const holdDays = holdDelayDaysOf(
    summary.unapprovedRunLengths.map((n) => ({ unapprovedDays: n, released: false })), 2, true
  );
  const r = computeSalary({
    ...rules,
    summary,
    holdDelayDays: holdDays,
    holidayDeductionDays: holidayBlocks.length,
    compOffUsed: undefined,
  } as Parameters<typeof computeSalary>[0]);

  assert.equal(r.lateDeduction, 200);           // 2 late days x 100
  assert.equal(r.lateMarksDeduction, 500);      // every 2 late days: 0.5 day x 1000
  assert.equal(r.earlyLeaveDeduction, 50);
  assert.equal(r.halfDayDeduction, 1000);       // 2 half days x 500
  assert.equal(r.leaveDeduction, 1000);         // 2 leave days, 1 covered by the Sunday worked
  assert.equal(r.holidayDeduction, 1000);       // Sat 14 / Sun 15 block with unauthorized days either side
  assert.equal(r.totalDeductions, 4050);        // includes the 300 manual deduction
  assert.equal(r.holdDays, 6);                  // 3 unapproved days x 2
  assert.equal(r.holdAmount, 0);
  assert.equal(r.netPayable, 22950);            // 30000 - 3000 absent - 4050, paid in full

  const ledger: LedgerEntry[] = buildDeductionLedger({
    summary,
    dailyRate: 1000,
    lateRule: rules.lateRule,
    halfDayRule: rules.halfDayRule,
    leaveRule: rules.leaveRule,
    earlyLeaveRule: rules.earlyLeaveRule,
    lateMarks: rules.lateMarks,
    compOffUsed: r.compOffUsed,
    holidayBlocks,
    otherDeductions: rules.otherDeductions,
  });

  const total = ledger.reduce((t, l) => t + l.amount, 0);
  assert.equal(Math.round(total * 100) / 100, 3000 + r.totalDeductions, "absent days plus every deduction");

  const kinds = (k: string) => ledger.filter((l) => l.kind === k);
  assert.equal(kinds("unapproved_absence").length, 3);
  assert.equal(kinds("late").length, 2);
  assert.equal(kinds("late_marks").length, 1);
  assert.equal(kinds("late_marks")[0].date, "2026-11-11", "the second late day triggers the late-marks penalty");
  assert.equal(kinds("half_day").length, 2);
  assert.equal(kinds("early_leave")[0].date, "2026-11-05");
  assert.equal(kinds("unpaid_leave").length, 1);
  assert.equal(kinds("unpaid_leave")[0].date, "2026-11-10", "the earliest leave day is the comp-off day");
  assert.equal(kinds("comp_off_covered")[0].date, "2026-11-09");
  assert.equal(kinds("comp_off_covered")[0].amount, 0);
  assert.equal(kinds("holiday_cut")[0].date, "2026-11-14");
  assert.equal(kinds("manual")[0].date, null);
  assert.equal(ledger[ledger.length - 1].kind, "manual", "manual deductions have no date and come last");
});

test("every log line says why, with the time the employee punched", () => {
  const { summary, holidayBlocks } = november();
  const ledger = buildDeductionLedger({
    summary, dailyRate: 1000, lateRule: rules.lateRule, halfDayRule: rules.halfDayRule, leaveRule: rules.leaveRule,
    earlyLeaveRule: rules.earlyLeaveRule, lateMarks: rules.lateMarks, compOffUsed: 1, holidayBlocks, otherDeductions: [],
  });
  const byDate = (d: string) => ledger.filter((l) => l.date === d).map((l) => l.reason);
  assert.match(byDate("2026-11-03")[0], /punched in at 09:25/);
  assert.match(byDate("2026-11-04")[0], /^Half day: punched in at 10:30/);
  assert.match(byDate("2026-11-05")[0], /left at 17:00, 60 min before shift end/);
  assert.match(byDate("2026-11-06")[0], /Unapproved absence: no punch and no approved leave/);
  assert.match(byDate("2026-11-13")[0], /Auto-absent: punched in at 14:00/);
  assert.match(byDate("2026-11-12")[0], /entered by admin/);
});

test("a released hold does not delay the salary; switching the hold off removes all delays", () => {
  assert.equal(holdDelayDaysOf([{ unapprovedDays: 2, released: true }], 2, true), 0);
  assert.equal(holdDelayDaysOf([{ unapprovedDays: 2, released: false }], 2, false), 0);
  const { summary } = november();
  const r = computeSalary({ ...rules, summary, holdDelayDays: 0, otherDeductions: [] });
  assert.equal(r.holdDays, 0);
  assert.equal(r.netPayable, r.netBeforeHold);
});
