import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeSalary, cyclePeriod, dateKey, holidayDeductionDays, isUnauthorizedAbsence, parseWeeklyOff,
  type AbsenceContext, type DayRecord,
} from "../src/lib/payroll.ts";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const NOV = cyclePeriod(2026, 11, 1); // 1 Nov → 30 Nov 2026 (1 Nov 2026 is a Sunday)

/**
 * A fixture where every WORKING day is present unless listed as absent. (A working day with no record
 * would otherwise count as an absence, which is the real rule.) Off-days get no punches.
 */
function world(opts: {
  absent?: string[];
  worked?: string[]; // off-days with a punch
  weeklyOff?: string;
  holidays?: string[];
  leaves?: { start: string; end: string }[];
  joinDate?: string;
  todayLocal?: string;
  loadedEnd?: string;
  trigger?: never;
} = {}): AbsenceContext {
  const weeklyOff = parseWeeklyOff(opts.weeklyOff ?? "0");
  const holidays = new Set(opts.holidays ?? []);
  const absent = new Set(opts.absent ?? []);
  const worked = new Set(opts.worked ?? []);
  const loadedStart = d("2026-09-25");
  const loadedEnd = d(opts.loadedEnd ?? "2026-12-07");
  const records = new Map<string, DayRecord>();
  for (let t = loadedStart.getTime(); t <= loadedEnd.getTime(); t += 86400000) {
    const day = new Date(t);
    const key = dateKey(day);
    const off = weeklyOff.has(day.getUTCDay()) || holidays.has(key);
    if (off) {
      if (worked.has(key)) records.set(key, { status: "present", hasPunchIn: true, hasPunchOut: true });
      continue;
    }
    if (absent.has(key)) continue; // no punch and no leave: an unauthorized absence
    records.set(key, { status: "present", hasPunchIn: true, hasPunchOut: true });
  }
  return {
    weeklyOff,
    holidays,
    records,
    approvedLeaves: (opts.leaves ?? []).map((l) => ({ start: d(l.start), end: d(l.end) })),
    todayLocal: d(opts.todayLocal ?? "2026-12-01"),
    joinDate: opts.joinDate ? d(opts.joinDate) : null,
    loadedStart,
    loadedEnd,
  };
}

test("Saturday and Monday unauthorized around a Sunday cuts one day's pay (trigger 2)", () => {
  assert.equal(holidayDeductionDays(NOV, world({ absent: ["2026-11-07", "2026-11-09"] }), 2), 1);
});

test("one-sided unauthorized leave: no cut at trigger 2, a cut at trigger 1", () => {
  const c = world({ absent: ["2026-11-07"] });
  assert.equal(holidayDeductionDays(NOV, c, 2), 0);
  assert.equal(holidayDeductionDays(NOV, c, 1), 1);
});

test("working on the Sunday cancels the cut", () => {
  assert.equal(holidayDeductionDays(NOV, world({ absent: ["2026-11-07", "2026-11-09"], worked: ["2026-11-08"] }), 2), 0);
});

test("approved leave on the neighbouring days is not unauthorized", () => {
  const c = world({ absent: ["2026-11-09"], leaves: [{ start: "2026-11-07", end: "2026-11-07" }] });
  // Sat 7 is approved leave, so it is NOT an unauthorized day. Only Mon 9 counts: enough for trigger 1, not trigger 2.
  assert.equal(holidayDeductionDays(NOV, c, 1), 1);
  assert.equal(holidayDeductionDays(NOV, c, 2), 0);
});

test("a company holiday is a non-working block: Friday holiday with Thursday and Saturday absent is cut", () => {
  assert.equal(holidayDeductionDays(NOV, world({ holidays: ["2026-11-13"], absent: ["2026-11-12", "2026-11-14"] }), 2), 1);
});

test("adjacent weekly off and holiday form ONE block, cut once", () => {
  // Sat + Sun off, Mon holiday: block = Sat 7 .. Mon 9; neighbours Fri 6 and Tue 10
  assert.equal(holidayDeductionDays(NOV, world({ weeklyOff: "0,6", holidays: ["2026-11-09"], absent: ["2026-11-06", "2026-11-10"] }), 2), 1);
});

test("a block that starts in the previous cycle is counted there, not in this one", () => {
  const oct = cyclePeriod(2026, 10, 1);
  // Block = Sat 31 Oct + Sun 1 Nov. Neighbours: Fri 30 Oct and Mon 2 Nov.
  const c = world({ weeklyOff: "0,6", absent: ["2026-10-30", "2026-11-02"] });
  assert.equal(holidayDeductionDays(oct, c, 2), 1, "counted in October");
  assert.equal(holidayDeductionDays(NOV, c, 2), 0, "not counted again in November");
});

test("a block that spills into the next cycle is counted once, in the cycle where it starts", () => {
  const oct = cyclePeriod(2026, 10, 1);
  const c = world({ weeklyOff: "0,6", absent: ["2026-10-30", "2026-11-02"] });
  // The Sat 31 Oct block lies on the boundary; across both cycles it must be cut exactly once.
  assert.equal(holidayDeductionDays(oct, c, 2) + holidayDeductionDays(NOV, c, 2), 1);
});

test("days before the employee joined are never absences, so no cut", () => {
  assert.equal(holidayDeductionDays(NOV, world({ absent: ["2026-11-07", "2026-11-09"], joinDate: "2026-11-10" }), 2), 0);
});

test("today and future days are not absences yet", () => {
  assert.equal(holidayDeductionDays(NOV, world({ absent: ["2026-11-07", "2026-11-09"], todayLocal: "2026-11-09" }), 2), 0);
});

test("days outside the loaded records are unknown and never counted", () => {
  const c = world({ absent: ["2026-11-07", "2026-11-09"], loadedEnd: "2026-11-08" });
  assert.equal(holidayDeductionDays(NOV, c, 2), 0);
  assert.equal(isUnauthorizedAbsence(d("2026-11-09"), c), false);
});

test("the cut is priced at one daily rate and included in total deductions", () => {
  const base = { basicSalary: 30000, workDaysPerMonth: 30, lateRule: { type: "fixed" as const, value: 0 }, halfDayRule: { type: "fixed" as const, value: 0 }, leaveRule: { type: "fixed" as const, value: 0 }, otherDeductions: [] };
  const summary = { presentDays: 26, lateDays: 0, halfDays: 0, leaveDays: 0, absentDays: 0, unapprovedOccurrences: [] };
  const r = computeSalary({ ...base, summary, holidayDeductionDays: 1 });
  assert.equal(r.holidayDeductionDays, 1);
  assert.equal(r.holidayDeduction, 1000);
  assert.equal(r.totalDeductions, 1000);
  assert.equal(r.netPayable, 29000);
});
