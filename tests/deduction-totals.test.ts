import assert from "node:assert/strict";
import { test } from "node:test";
import { cyclePeriod, buildDeductionLedger, computeSalary, dateKey, summarizeMonth } from "../src/lib/payroll.ts";
import { allDeductionsTotal, ledgerTotal, unapprovedAbsenceDeduction } from "../src/lib/deduction-totals.ts";

// Mirrors the salary pipeline in src/lib/salary.ts (computeFromData) without the database.
const TODAY = Date.UTC(2026, 10, 17); // 17 Nov 2026
const BASIC = 15000;
const DAILY = BASIC / 30;
const d = (day: number) => `2026-11-${String(day).padStart(2, "0")}`;

type Rec = {
  id: string;
  excused: boolean;
  status: string;
  hasPunchIn: boolean;
  hasPunchOut: boolean;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  punchInMinutes: number | null;
  punchOutMinutes: number | null;
};

function present(id: string, status = "present", inMin = 9 * 60, outMin = 18 * 60): Rec {
  return { id, excused: false, status, hasPunchIn: true, hasPunchOut: true, earlyLeaveMinutes: 0, overtimeMinutes: 0, punchInMinutes: inMin, punchOutMinutes: outMin };
}

function compute(records: Map<string, Rec>, approvedLeaves: { start: Date; end: Date }[]) {
  const period = cyclePeriod(2026, 11, 1);
  const summary = summarizeMonth({
    year: 2026,
    month: 11,
    period,
    weeklyOff: new Set([0]),
    records: records as never,
    approvedLeaves,
    todayLocal: new Date(TODAY),
    live: { nowMinutes: 8 * 60, absentAfterMinutes: 13 * 60 + 30 },
  });
  const lateRule = { type: "fixed" as const, value: 0 };
  const halfDayRule = { type: "percentage" as const, value: 50 };
  const leaveRule = { type: "percentage" as const, value: 100 };
  const result = computeSalary({
    basicSalary: BASIC,
    workDaysPerMonth: 30,
    summary,
    lateRule,
    halfDayRule,
    leaveRule,
    otherDeductions: [],
    holidayDeductionDays: 0,
  });
  const ledger = buildDeductionLedger({
    summary,
    dailyRate: DAILY,
    lateRule,
    halfDayRule,
    leaveRule,
    compOffUsed: result.compOffUsed,
    holidayBlocks: [],
    otherDeductions: [],
  });
  return { summary, result, ledger };
}

test("two unapproved absences: summary shows ₹1,000 of absence and the log adds up to the same total", () => {
  // Nov 2 worked, Nov 3 and 4 no punch and no leave (unapproved), Nov 5-16 covered by approved leave.
  const recs = new Map<string, Rec>([[d(2), present("a")]]);
  const leaves = [{ start: new Date(Date.UTC(2026, 10, 5)), end: new Date(Date.UTC(2026, 10, 16)) }];
  const { summary, result, ledger } = compute(recs, leaves);

  assert.equal(summary.absentDays, 2);
  const absence = unapprovedAbsenceDeduction(BASIC, result.attendanceSalary);
  assert.equal(absence, 1000);

  const total = allDeductionsTotal(absence, result.totalDeductions);
  assert.equal(ledgerTotal(ledger), total, "the day-wise log must add up to the summary total");

  const absenceLines = ledger.filter((l) => l.kind === "unapproved_absence");
  assert.equal(absenceLines.length, 2);
  assert.ok(absenceLines.every((l) => l.amount === 500));
});

test("mixed month: late, half-day, unpaid leave and absences all reconcile with the log", () => {
  const recs = new Map<string, Rec>([
    [d(2), present("a")],
    [d(5), present("b", "late", 10 * 60 + 30, 18 * 60)],
    [d(6), present("c", "half_day", 9 * 60, 13 * 60)],
    // Nov 3 and 4: no punch, no leave, so unapproved. Nov 10 is a Sunday (weekly off).
  ]);
  const leaves = [{ start: new Date(Date.UTC(2026, 10, 7)), end: new Date(Date.UTC(2026, 10, 9)) }];
  const { summary, result, ledger } = compute(recs, leaves);

  assert.ok(summary.absentDays >= 2);
  const absence = unapprovedAbsenceDeduction(BASIC, result.attendanceSalary);
  const total = allDeductionsTotal(absence, result.totalDeductions);
  assert.equal(ledgerTotal(ledger), total);
});

test("net payable equals basic minus every deduction (no double count)", () => {
  const recs = new Map<string, Rec>([[d(2), present("a")]]);
  const leaves = [{ start: new Date(Date.UTC(2026, 10, 5)), end: new Date(Date.UTC(2026, 10, 16)) }];
  const { result } = compute(recs, leaves);
  const absence = unapprovedAbsenceDeduction(BASIC, result.attendanceSalary);
  const total = allDeductionsTotal(absence, result.totalDeductions);
  assert.equal(Math.round((BASIC - total) * 100) / 100, result.netPayable);
});

test("ledgerTotal ignores zero-amount lines and rounds to paise", () => {
  assert.equal(ledgerTotal([{ amount: 0.1 }, { amount: 0.2 }, { amount: 0 }]), 0.3);
});

test("date helper is available for the test fixtures", () => {
  assert.equal(dateKey(new Date(Date.UTC(2026, 10, 3))), "2026-11-03");
});
