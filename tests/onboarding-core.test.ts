import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_COMPLETE_AFTER_HOURS,
  OnboardingValidationError,
  commissionAmountFor,
  commissionPercentFor,
  monthlyBreakdown,
  normalizeContact,
  quoteOnboarding,
  ratingStage,
  isDelayed,
  validateSatisfaction,
  meetsBenchmark,
} from "../src/lib/onboarding-core.ts";

const tiers = [
  { maxEmployees: 10, pricePerEmployee: 60 },
  { maxEmployees: 25, pricePerEmployee: 50 },
  { maxEmployees: null, pricePerEmployee: 40 },
];

test("slabs: up to 10 at 60, up to 25 at 50, above 25 at 40 (all-units rate)", () => {
  assert.equal(quoteOnboarding({ includeOnboarding: false, includeEmployees: true, employeeCount: 1, baseFee: 0, tiers }).employeeRate, 60);
  assert.equal(quoteOnboarding({ includeOnboarding: false, includeEmployees: true, employeeCount: 10, baseFee: 0, tiers }).employeeRate, 60);
  assert.equal(quoteOnboarding({ includeOnboarding: false, includeEmployees: true, employeeCount: 11, baseFee: 0, tiers }).employeeRate, 50);
  assert.equal(quoteOnboarding({ includeOnboarding: false, includeEmployees: true, employeeCount: 25, baseFee: 0, tiers }).employeeRate, 50);
  assert.equal(quoteOnboarding({ includeOnboarding: false, includeEmployees: true, employeeCount: 26, baseFee: 0, tiers }).employeeRate, 40);
});

test("total combines base fee and employee fee", () => {
  const q = quoteOnboarding({ includeOnboarding: true, includeEmployees: true, employeeCount: 12, baseFee: 2000, tiers });
  assert.equal(q.employeeFee, 600);
  assert.equal(q.total, 2600);
});

test("onboarding only uses the base fee alone", () => {
  const q = quoteOnboarding({ includeOnboarding: true, includeEmployees: false, employeeCount: 99, baseFee: 1500, tiers });
  assert.equal(q.total, 1500);
  assert.equal(q.employeeFee, 0);
});

test("a zero base fee blocks checkout until the owner configures it", () => {
  assert.throws(
    () => quoteOnboarding({ includeOnboarding: true, includeEmployees: false, employeeCount: 0, baseFee: 0, tiers }),
    OnboardingValidationError
  );
});

test("must choose at least one service and a positive headcount when adding employees", () => {
  assert.throws(() => quoteOnboarding({ includeOnboarding: false, includeEmployees: false, employeeCount: 0, baseFee: 1, tiers }));
  assert.throws(() => quoteOnboarding({ includeOnboarding: false, includeEmployees: true, employeeCount: 0, baseFee: 1, tiers }));
});

test("contact: same-as-WhatsApp copies the number; otherwise the calling number is validated", () => {
  const same = normalizeContact({ whatsapp: "+91 98765-43210", email: "Ops@Acme.IN", call: "", callSameAsWhatsapp: true });
  assert.equal(same.call, "+919876543210");
  assert.equal(same.email, "ops@acme.in");
  assert.throws(() => normalizeContact({ whatsapp: "12", email: "a@b.co", call: "", callSameAsWhatsapp: true }));
  assert.throws(() => normalizeContact({ whatsapp: "9876543210", email: "bad", call: "", callSameAsWhatsapp: true }));
  assert.throws(() => normalizeContact({ whatsapp: "9876543210", email: "a@b.co", call: "abc", callSameAsWhatsapp: false }));
});

test("commission: specialist override beats the global default; amounts round to paise", () => {
  assert.equal(commissionPercentFor(null, 10), 10);
  assert.equal(commissionPercentFor(15, 10), 15);
  assert.equal(commissionPercentFor(0, 10), 0);
  assert.equal(commissionAmountFor(2599, 12.5), 324.88);
});

test("satisfaction must be an integer 0-100 and the benchmark is 60", () => {
  assert.equal(validateSatisfaction(0), 0);
  assert.equal(validateSatisfaction(100), 100);
  assert.throws(() => validateSatisfaction(101), OnboardingValidationError);
  assert.throws(() => validateSatisfaction(72.5), OnboardingValidationError);
  assert.equal(meetsBenchmark(60), true);
  assert.equal(meetsBenchmark(59), false);
});

test("rating timeline: waiting, reminder at 24h, auto-complete at 48h", () => {
  const done = new Date("2026-11-01T00:00:00Z");
  assert.equal(ratingStage(done, new Date("2026-11-01T10:00:00Z")), "waiting");
  assert.equal(ratingStage(done, new Date("2026-11-02T00:00:00Z")), "reminder");
  assert.equal(ratingStage(done, new Date(done.getTime() + AUTO_COMPLETE_AFTER_HOURS * 3600_000)), "auto_complete");
});

test("delayed: claimed for 48h or more without completion", () => {
  const claimed = new Date("2026-11-01T00:00:00Z");
  assert.equal(isDelayed(claimed, new Date("2026-11-02T23:00:00Z")), false);
  assert.equal(isDelayed(claimed, new Date("2026-11-03T00:00:00Z")), true);
});

test("monthly breakdown: totals, averages, benchmark flag, only the requested month", () => {
  const rows = [
    { specialistId: "a", completedAt: new Date("2026-11-05T00:00:00Z"), satisfaction: 90, commissionAmount: 300 },
    { specialistId: "a", completedAt: new Date("2026-11-20T00:00:00Z"), satisfaction: 70, commissionAmount: 200 },
    { specialistId: "b", completedAt: new Date("2026-11-10T00:00:00Z"), satisfaction: 40, commissionAmount: 500 },
    { specialistId: "b", completedAt: new Date("2026-10-10T00:00:00Z"), satisfaction: 99, commissionAmount: 999 },
    { specialistId: "c", completedAt: new Date("2026-11-11T00:00:00Z"), satisfaction: null, commissionAmount: 100 },
  ];
  const out = monthlyBreakdown(rows, "2026-11");
  const a = out.find((r) => r.specialistId === "a")!;
  const b = out.find((r) => r.specialistId === "b")!;
  assert.equal(a.completed, 2);
  assert.equal(a.averageSatisfaction, 80);
  assert.equal(a.commission, 500);
  assert.equal(a.belowBenchmark, false);
  assert.equal(b.commission, 500);
  assert.equal(b.belowBenchmark, true);
  assert.equal(out.find((r) => r.specialistId === "c")!.averageSatisfaction, null);
  assert.equal(out[0].specialistId, "a"); // sorted by commission, ties keep insertion order
});
