import assert from "node:assert/strict";
import { test } from "node:test";
import { computeStatus } from "../src/lib/payroll.ts";
import {
  RULES,
  RULE_BY_ID,
  changesBetween,
  clockOf,
  deductionText,
  matchesQuery,
  previewDay,
  rulesMatching,
  summarizeRules,
  validateRules,
  type RuleValues,
} from "../src/lib/rules-check.ts";

const TZ = "Asia/Kolkata";
const at = (hhmm: string, day = "2026-11-05") => new Date(`${day}T${hhmm}:00+05:30`);

/** A set of rules that is valid as saved on the server. */
const VALID: RuleValues = {
  shiftStart: "09:00",
  shiftEnd: "18:00",
  weeklyOff: "0",
  graceMinutes: "5",
  lateThresholdMinutes: "30",
  lateDeductionType: "percentage",
  lateDeductionValue: "5",
  lateMarksLimit: "0",
  lateMarksPenaltyDays: "0.5",
  earlyLeaveGraceMinutes: "5",
  earlyLeaveHalfDayMinutes: "0",
  earlyLeaveDeductionType: "percentage",
  earlyLeaveDeductionValue: "0",
  halfDayDeductionType: "percentage",
  halfDayDeductionValue: "50",
  leaveDeductionType: "percentage",
  leaveDeductionValue: "100",
  salaryHoldEnabled: true,
  unapprovedHoldDays: "2",
  overtimeEnabled: false,
  overtimeMinMinutes: "30",
  overtimeRate: "1.5",
  overtimeMaxMinutesPerDay: "240",
  extraPayEnabled: false,
  extraPayRate: "1",
  absentAfterPercentEnabled: false,
  absentAfterPercent: "50",
  holidayDeductionEnabled: false,
  holidayDeductionTriggerCount: "2",
  midCycleSlipEnabled: false,
  leaveAccrualMode: "carry",
  salaryCycleStartDay: "1",
  salaryDisbursementDay: "5",
};

const withValues = (patch: Record<string, string | boolean>): RuleValues => ({ ...VALID, ...patch });

// ------------------------------------------------------------------ validation

test("a valid set of rules has no problems", () => {
  assert.deepEqual(validateRules(VALID), []);
});

test("an empty number is reported, not silently read as 0", () => {
  const problems = validateRules(withValues({ graceMinutes: "" }));
  assert.equal(problems.length, 1);
  assert.equal(problems[0].field, "graceMinutes");
  assert.equal(problems[0].ruleId, "rule-late");
});

test("values outside the server's limits are blocked before saving", () => {
  const fields = validateRules(withValues({ graceMinutes: "121", overtimeRate: "9", lateMarksPenaltyDays: "6" }));
  const names = fields.map((p) => p.field).sort();
  assert.deepEqual(names, ["graceMinutes", "lateMarksPenaltyDays"]);
});

test("the half-day cut-off must be later than the cool-off, as on the server", () => {
  const problems = validateRules(withValues({ graceMinutes: "20", lateThresholdMinutes: "10" }));
  assert.ok(problems.some((p) => p.field === "lateThresholdMinutes" && p.message.includes("later than the cool-off")));
  // Equal is allowed by the server, so it must be allowed here too.
  assert.deepEqual(validateRules(withValues({ graceMinutes: "20", lateThresholdMinutes: "20" })), []);
});

test("a percentage deduction cannot go above 100, but a fixed amount can", () => {
  const percent = validateRules(withValues({ halfDayDeductionValue: "150" }));
  assert.equal(percent.length, 1);
  assert.equal(percent[0].ruleId, "rule-half-day");
  assert.deepEqual(validateRules(withValues({ halfDayDeductionType: "fixed", halfDayDeductionValue: "150" })), []);
});

test("early-leave half-day limit must be 0 (off) or at least the early-leave cool-off", () => {
  const bad = validateRules(withValues({ earlyLeaveGraceMinutes: "15", earlyLeaveHalfDayMinutes: "10" }));
  assert.ok(bad.some((p) => p.field === "earlyLeaveHalfDayMinutes"));
  assert.deepEqual(validateRules(withValues({ earlyLeaveGraceMinutes: "15", earlyLeaveHalfDayMinutes: "0" })), []);
  assert.deepEqual(validateRules(withValues({ earlyLeaveGraceMinutes: "15", earlyLeaveHalfDayMinutes: "15" })), []);
});

test("whole-number fields reject decimals", () => {
  const problems = validateRules(withValues({ graceMinutes: "5.5" }));
  assert.equal(problems[0].message, "Use a whole number.");
});

test("hidden rules that are switched off are not checked", () => {
  // Overtime is off, so an empty overtime rate does not block saving.
  assert.deepEqual(validateRules(withValues({ overtimeEnabled: false, overtimeRate: "" })), []);
  // Turned on, the same empty value is a problem on the Overtime rule.
  const on = validateRules(withValues({ overtimeEnabled: true, overtimeRate: "" }));
  assert.equal(on[0].ruleId, "rule-overtime");
});

test("the salary cycle start day must be 1 to 28", () => {
  assert.equal(validateRules(withValues({ salaryCycleStartDay: "29" }))[0].ruleId, "rule-salary-cycle");
  assert.deepEqual(validateRules(withValues({ salaryCycleStartDay: "26" })), []);
});

// ------------------------------------------------------------------ change summary

test("no change means no summary entries", () => {
  assert.deepEqual(changesBetween(VALID, { ...VALID }), []);
  assert.deepEqual(changesBetween(null, VALID), []);
});

test("a changed number is described in plain words", () => {
  const changes = changesBetween(VALID, withValues({ graceMinutes: "10" }));
  assert.equal(changes.length, 1);
  assert.equal(changes[0].label, "Late cool-off");
  assert.equal(changes[0].from, "5 min after shift start");
  assert.equal(changes[0].to, "10 min after shift start");
});

test("a switched-off rule does not report its hidden values as changes", () => {
  // Overtime is off, so changing its rate does not change how a day is paid.
  assert.deepEqual(changesBetween(VALID, withValues({ overtimeRate: "2" })), []);
  // Switching it on does show up.
  const on = changesBetween(VALID, withValues({ overtimeEnabled: true }));
  assert.deepEqual(on.map((c) => c.label), ["Overtime"]);
});

test("the deduction type and amount are summarised together", () => {
  assert.equal(deductionText("percentage", "50"), "50% of the daily rate");
  assert.equal(deductionText("fixed", "200"), "fixed ₹200");
  assert.equal(deductionText("fixed", "0"), "No deduction");
  const changes = changesBetween(VALID, withValues({ lateDeductionType: "fixed", lateDeductionValue: "200" }));
  assert.equal(changes[0].to, "fixed ₹200");
});

test("weekly offs are listed by name", () => {
  const item = summarizeRules(withValues({ weeklyOff: "0,6" })).find((i) => i.key === "weeklyOff");
  assert.equal(item?.value, "Sunday, Saturday");
});

// ------------------------------------------------------------------ test a day

test("'Test a day' gives the same status as the server for the same punch-in times", () => {
  const policies: { label: string; rules: RuleValues; shift: string }[] = [
    { label: "plain rules", rules: VALID, shift: "09:00" },
    { label: "auto-absent at 50%", rules: withValues({ absentAfterPercentEnabled: true, absentAfterPercent: "50" }), shift: "09:00" },
  ];
  const titleToStatus: Record<string, string> = {
    "On time": "present",
    Late: "late",
    "Half day": "half_day",
    Absent: "absent",
  };
  for (const policy of policies) {
    for (const punch of ["08:55", "09:00", "09:04", "09:05", "09:06", "09:30", "09:31", "09:45", "13:20", "13:30", "13:45", "16:00"]) {
      const preview = previewDay(policy.rules, punch, "");
      const serverStatus = computeStatus(at(punch), {
        shiftStart: "09:00",
        shiftEnd: "18:00",
        graceMinutes: 5,
        lateThresholdMinutes: 30,
        timezone: TZ,
        absentAfterPercent: policy.rules.absentAfterPercentEnabled === true ? 50 : null,
      });
      assert.equal(titleToStatus[preview[0].title], serverStatus, `${policy.label}: punch ${punch}`);
    }
  }
});

test("'Test a day' needs a valid punch-in time", () => {
  assert.deepEqual(previewDay(VALID, "", ""), []);
  assert.deepEqual(previewDay(VALID, "9am", ""), []);
});

test("an early leave is charged only when an early-leave deduction is set", () => {
  const none = previewDay(VALID, "09:00", "17:30");
  const early = none.find((l) => l.title === "Early leave");
  assert.ok(early);
  assert.ok(early.detail.includes("costs nothing"));
  const charged = previewDay(withValues({ earlyLeaveDeductionValue: "25" }), "09:00", "17:30");
  assert.ok(charged.find((l) => l.title === "Early leave")?.detail.includes("25% of the daily rate"));
});

test("leaving more than the early-leave half-day limit early is a half day", () => {
  const rules = withValues({ earlyLeaveHalfDayMinutes: "120" });
  const lines = previewDay(rules, "09:00", "15:30");
  assert.equal(lines.find((l) => l.title === "Half day (left early)")?.tone, "bad");
});

test("overtime counts from the minimum, is capped per day, and is paid at the rate", () => {
  const rules = withValues({ overtimeEnabled: true, overtimeMinMinutes: "30", overtimeRate: "1.5", overtimeMaxMinutesPerDay: "240" });
  const overtime = previewDay(rules, "09:00", "19:45").find((l) => l.title === "Overtime");
  assert.ok(overtime);
  assert.equal(overtime.tone, "good");
  assert.ok(overtime.detail.startsWith("105 minutes paid at 1.5×"));

  const short = previewDay(rules, "09:00", "18:20").find((l) => l.title === "Overtime");
  assert.equal(short?.tone, "info");

  const capped = previewDay(rules, "09:00", "23:00").find((l) => l.title === "Overtime");
  assert.ok(capped?.detail.startsWith("240 minutes paid"));
  assert.ok(capped?.detail.includes("capped at 240 minutes"));
});

test("overtime is only reported as unpaid when overtime pay is switched off", () => {
  const line = previewDay(VALID, "09:00", "19:00").find((l) => l.title === "Overtime");
  assert.equal(line?.tone, "info");
  assert.ok(line?.detail.includes("Overtime pay is off"));
});

test("clockOf wraps and rounds times", () => {
  assert.equal(clockOf(13.4 * 60 + 0), "13:24");
  assert.equal(clockOf(9 * 60 + 60 * 14), "23:00");
});

// ------------------------------------------------------------------ search and index

test("rule ids are unique and every rule has a category", () => {
  const ids = RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of RULES) {
    assert.ok(r.title.length > 0 && r.hint.length > 0, r.id);
    assert.ok(["hours", "pay", "extra", "days", "cycle", "records"].includes(r.category), r.id);
  }
  assert.equal(RULE_BY_ID["rule-paid-holidays"].title, "Paid holidays");
});

test("the paid-holiday anchor linked from the Attendance page still exists", () => {
  assert.ok(RULE_BY_ID["rule-paid-holidays"]);
});

test("an empty search shows every rule", () => {
  assert.equal(rulesMatching("   ").length, RULES.length);
});

test("every word typed must match", () => {
  assert.equal(matchesQuery("late deduction", "Late arrival. Late deduction applies"), true);
  assert.equal(matchesQuery("late overtime", "Late arrival"), false);
});

test("searching for a word finds the rules that use it", () => {
  const sunday = rulesMatching("sunday");
  assert.ok(sunday.includes("rule-comp-off"));
  assert.ok(sunday.includes("rule-holiday-cut"));
  assert.ok(sunday.includes("rule-weekly-off"));
  assert.ok(!rulesMatching("sunday").includes("rule-overtime"));
  assert.ok(rulesMatching("late").includes("rule-late"));
  assert.deepEqual(rulesMatching("zzz-nothing"), []);
});
