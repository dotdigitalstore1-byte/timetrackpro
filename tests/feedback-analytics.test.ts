import assert from "node:assert/strict";
import { test } from "node:test";
import {
  QUESTIONS,
  QUESTIONNAIRE_VERSION,
  feedbackSlot,
  leniencyBand,
  leniencyIndex,
  questionLeniency,
  validateAnswers,
  type Answers,
} from "../src/lib/feedback.ts";
import {
  anonymizedLabels,
  bandSummaries,
  correlate,
  describeR,
  pearson,
  type CompanyMetrics,
} from "../src/lib/feedback-analytics.ts";

const allStrict: Answers = {
  accident_late: ["full_day_deduction"],
  missed_punch: ["no_corrections"],
  grace_deductions: ["strict_no_review"],
  repeat_issues: ["penalty_first"],
};
const allLenient: Answers = {
  accident_late: ["excuse_fully"],
  missed_punch: ["correction_request"],
  grace_deductions: ["grace_and_review"],
  repeat_issues: ["private_coaching"],
};

test("feedback: the questionnaire version and question set are stable", () => {
  assert.equal(QUESTIONNAIRE_VERSION, 1);
  assert.equal(QUESTIONS.length, 4);
});

test("feedback: leniency is 0 for the strictest choices and 100 for the most lenient", () => {
  assert.equal(leniencyIndex(allStrict), 0);
  assert.equal(leniencyIndex(allLenient), 100);
});

test("feedback: multi-select averages the chosen options", () => {
  const q = QUESTIONS[0];
  assert.equal(questionLeniency(q, ["excuse_fully", "full_day_deduction"]), 50);
  assert.equal(questionLeniency(q, []), 0);
});

test("feedback: validation requires every question and only known options", () => {
  const ok = validateAnswers(allLenient);
  assert.equal(ok.ok, true);
  assert.equal(validateAnswers({ ...allLenient, missed_punch: [] }).ok, false);
  assert.equal(validateAnswers({ ...allLenient, missed_punch: ["made_up"] }).ok, false);
  assert.equal(validateAnswers(null).ok, false);
  const dedup = validateAnswers({ ...allLenient, grace_deductions: ["grace_only", "grace_only"] });
  assert.ok(dedup.ok);
  assert.deepEqual(dedup.ok && dedup.answers.grace_deductions, ["grace_only"]);
});

test("feedback: a 30-day cycle is split into three slots of about ten days", () => {
  const start = "2026-11-01";
  const end = "2026-11-30";
  assert.equal(feedbackSlot(start, end, "2026-11-01"), 0);
  assert.equal(feedbackSlot(start, end, "2026-11-10"), 0);
  assert.equal(feedbackSlot(start, end, "2026-11-11"), 1);
  assert.equal(feedbackSlot(start, end, "2026-11-20"), 1);
  assert.equal(feedbackSlot(start, end, "2026-11-21"), 2);
  assert.equal(feedbackSlot(start, end, "2026-11-30"), 2);
});

test("feedback: custom cycle start days work and bad dates fall back to slot 0", () => {
  // 26th to 25th cycle
  assert.equal(feedbackSlot("2026-10-26", "2026-11-25", "2026-10-27"), 0);
  assert.equal(feedbackSlot("2026-10-26", "2026-11-25", "2026-11-20"), 2);
  assert.equal(feedbackSlot("bad", "2026-11-25", "2026-11-20"), 0);
});

test("feedback: bands split at 40 and 70", () => {
  assert.equal(leniencyBand(39), "strict");
  assert.equal(leniencyBand(40), "balanced");
  assert.equal(leniencyBand(69), "balanced");
  assert.equal(leniencyBand(70), "lenient");
});

test("analytics: Pearson correlation for perfect, inverse and flat data", () => {
  assert.equal(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1);
  assert.equal(pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1);
  assert.equal(pearson([1, 2, 3], [5, 5, 5]), null);
  assert.equal(pearson([1], [1]), null);
});

test("analytics: correlations are withheld until enough companies respond", () => {
  const rows: CompanyMetrics[] = [1, 2, 3].map((i) => ({
    label: `Company 0${i}`, leniency: i * 10, stability: i * 10, onTimeRate: null, punchActivity: null, feedbackRate: null,
  }));
  const c = correlate(rows, "leniency", "stability", "Leniency", "Stability");
  assert.equal(c.r, null);
  assert.equal(c.n, 3);
  assert.match(c.reading, /Not enough companies/);
});

test("analytics: describeR is cautious and never claims causation", () => {
  assert.match(describeR(0.8, 10), /association only, not cause/);
  assert.equal(describeR(0.05, 10), "No clear relationship in this sample.");
});

test("analytics: band groups below the minimum size are not reported", () => {
  const mk = (leniency: number, stability: number): CompanyMetrics => ({
    label: "x", leniency, stability, onTimeRate: 90, punchActivity: 80, feedbackRate: 100,
  });
  const summaries = bandSummaries([mk(10, 90), mk(20, 80), mk(80, 70)]);
  const strict = summaries.find((s) => s.band === "strict");
  const lenient = summaries.find((s) => s.band === "lenient");
  assert.equal(strict?.companies, 2);
  assert.equal(strict?.stability, null); // only 2 companies: hidden
  assert.equal(lenient?.companies, 1);
  assert.equal(lenient?.stability, null);
  const bigger = bandSummaries([mk(10, 90), mk(20, 80), mk(30, 70)]).find((s) => s.band === "strict");
  assert.equal(bigger?.stability, 80);
});

test("analytics: anonymized labels are stable and do not reveal names", () => {
  const labels = anonymizedLabels(["b-id", "a-id"]);
  assert.equal(labels.get("a-id"), "Company 01");
  assert.equal(labels.get("b-id"), "Company 02");
});
