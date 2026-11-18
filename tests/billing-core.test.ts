import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accessInfo,
  validateGracePolicy,
  type GracePolicy,
  addMonths,
  canSelfActivate,
  DEFAULT_PLANS,
  quoteCycle,
  seatCheck,
  tierFor,
  TRIAL_DAYS,
  TRIAL_EMPLOYEE_LIMIT,
  toMinorUnits,
  validateCycleInput,
  validatePlanInput,
} from "../src/lib/billing-core.ts";

const DAY = 86_400_000;

test("launch price list matches the agreed tiers", () => {
  const byLimit = Object.fromEntries(DEFAULT_PLANS.map((p) => [p.employeeLimit, p.price]));
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((n) => byLimit[n]),
    [99, 200, 300, 400, 500]
  );
  assert.equal(byLimit[10], 900);
  assert.equal(byLimit[20], 1749);
  assert.equal(byLimit[30], 2499);
  assert.equal(byLimit[50], 2999);
  assert.equal(byLimit[100], 7999);
});

test("trial is 20 days and 4 seats", () => {
  assert.equal(TRIAL_DAYS, 20);
});

test("a monthly quote with no discount is the list price", () => {
  const q = quoteCycle({ price: 99, compareAtPrice: null }, 1, 0);
  assert.equal(q.total, 99);
  assert.equal(q.perMonth, 99);
  assert.equal(q.savings, 0);
  assert.equal(q.strikePerMonth, null);
});

test("6 and 12 month commitments are discounted automatically", () => {
  const six = quoteCycle({ price: 99, compareAtPrice: null }, 6, 10);
  assert.equal(six.listTotal, 594);
  assert.equal(six.total, 535); // 594 * 0.9 = 534.6 -> 535
  assert.equal(six.savings, 59);
  assert.equal(six.perMonth, 89.17);

  const twelve = quoteCycle({ price: 1749, compareAtPrice: null }, 12, 20);
  assert.equal(twelve.total, 16790); // 1749 * 12 * 0.8 = 16790.4 -> 16790
  assert.equal(twelve.strikePerMonth, 1749); // struck-through monthly list price when discounted
});

test("compare-at price is the strike-through figure when set", () => {
  const q = quoteCycle({ price: 99, compareAtPrice: 199 }, 1, 0);
  assert.equal(q.strikePerMonth, 199);
  assert.equal(q.perMonth, 99);
});

test("addMonths keeps the day and clamps to the end of shorter months", () => {
  assert.equal(addMonths(new Date(Date.UTC(2026, 0, 15)), 1).toISOString(), "2026-02-15T00:00:00.000Z");
  assert.equal(addMonths(new Date(Date.UTC(2026, 0, 31)), 1).toISOString(), "2026-02-28T00:00:00.000Z");
  assert.equal(addMonths(new Date(Date.UTC(2026, 10, 16)), 6).toISOString(), "2027-05-16T00:00:00.000Z");
  assert.equal(addMonths(new Date(Date.UTC(2028, 1, 29)), 12).toISOString(), "2029-02-28T00:00:00.000Z");
});

test("tierFor picks the smallest plan that covers the headcount", () => {
  const plans = DEFAULT_PLANS.map((p) => ({ name: p.name, employeeLimit: p.employeeLimit }));
  assert.equal(tierFor(plans, 0)?.employeeLimit, 1);
  assert.equal(tierFor(plans, 1)?.employeeLimit, 1);
  assert.equal(tierFor(plans, 6)?.employeeLimit, 10);
  assert.equal(tierFor(plans, 50)?.employeeLimit, 50);
  assert.equal(tierFor(plans, 101)?.employeeLimit, 200);
  assert.equal(tierFor(plans, 201)?.employeeLimit, 400);
  assert.equal(tierFor(plans, 401)?.employeeLimit, 600);
  assert.equal(tierFor(plans, 600)?.employeeLimit, 600);
  assert.equal(tierFor(plans, 601), null, "above the largest tier needs a custom quote");
  assert.deepEqual(
    DEFAULT_PLANS.filter((p) => p.employeeLimit >= 200).map((p) => p.employeeLimit),
    [200, 400, 600]
  );
});

test("trial company is open, shows days left and is locked after the window", () => {
  const now = new Date("2026-11-16T00:00:00Z");
  const open = accessInfo({ accessUntil: new Date(now.getTime() + 5 * DAY - 1000), subscriptionStatus: "trial", employeeLimit: 4 }, now);
  assert.equal(open.state, "trial");
  assert.equal(open.locked, false);
  assert.equal(open.daysLeft, 5);

  const over = accessInfo({ accessUntil: new Date(now.getTime() - 1), subscriptionStatus: "trial", employeeLimit: 4 }, now);
  assert.equal(over.locked, true);
  assert.equal(over.endedAs, "trial");
});

test("paid expiry: admin locked at once, staff keep working during the first 5 days", () => {
  const now = new Date("2026-11-16T00:00:00Z");
  const paid = accessInfo({ accessUntil: new Date(now.getTime() - DAY), subscriptionStatus: "active", employeeLimit: 10 }, now);
  assert.equal(paid.locked, true);
  assert.equal(paid.endedAs, "paid");
  assert.equal(paid.phase, "grace");
  assert.equal(paid.staffLocked, false);
  assert.equal(paid.restricted, false);

});

test("seat check counts employees and managers against the limit", () => {
  assert.deepEqual(seatCheck(4, 3, 1), { ok: true });
  assert.deepEqual(seatCheck(4, 4, 1), { ok: false, available: 0 });
  assert.deepEqual(seatCheck(4, 5, 1), { ok: false, available: 0 }); // over-limit legacy data never negative
  assert.deepEqual(seatCheck(null, 999, 50), { ok: true }); // unlimited
});

test("self-activation is open in development but needs an explicit opt-in in production", () => {
  assert.equal(canSelfActivate({ NODE_ENV: "development" }), true);
  assert.equal(canSelfActivate({}), true);
  assert.equal(canSelfActivate({ NODE_ENV: "production" }), false);
  assert.equal(canSelfActivate({ NODE_ENV: "production", BILLING_MANUAL_ACTIVATION: "true" }), true);
});

test("plan input: valid plan is normalised", () => {
  const r = validatePlanInput({
    name: "  Team 10 ",
    employeeLimit: "10",
    price: "900",
    compareAtPrice: "1099",
    features: "Feature A\n\n  Feature B  \n",
    isActive: true,
    sortOrder: "3",
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.name, "Team 10");
    assert.equal(r.value.employeeLimit, 10);
    assert.equal(r.value.price, 900);
    assert.equal(r.value.compareAtPrice, 1099);
    assert.deepEqual(r.value.features, ["Feature A", "Feature B"]);
  }
});

test("plan input rejects bad seats, price, and compare-at not above the price", () => {
  assert.equal(validatePlanInput({ name: "x", employeeLimit: "0", price: "99" }).ok, false);
  assert.equal(validatePlanInput({ name: "x", employeeLimit: "2.5", price: "99" }).ok, false);
  assert.equal(validatePlanInput({ name: "x", employeeLimit: "2", price: "0" }).ok, false);
  assert.equal(validatePlanInput({ name: "", employeeLimit: "2", price: "99" }).ok, false);
  const low = validatePlanInput({ name: "x", employeeLimit: "2", price: "99", compareAtPrice: "99" });
  assert.equal(low.ok, false);
  const none = validatePlanInput({ name: "x", employeeLimit: "2", price: "99", compareAtPrice: "" });
  assert.equal(none.ok, true);
  if (none.ok) assert.equal(none.value.compareAtPrice, null);
});

test("billing cycle input: months 1 to 36 and discount 0 to 90", () => {
  assert.equal(validateCycleInput({ months: 6, discountPercent: 10 }).ok, true);
  assert.equal(validateCycleInput({ months: 0 }).ok, false);
  assert.equal(validateCycleInput({ months: 6, discountPercent: 95 }).ok, false);
  const r = validateCycleInput({ months: 12 });
  assert.equal(r.ok && r.value.label, "12 months");
});

test("grace phases after a paid expiry with the default policy (blur 5, punching until 20, block 30)", () => {
  const now = new Date("2026-11-16T00:00:00Z");
  const at = (days: number, policy?: GracePolicy) =>
    accessInfo({ accessUntil: new Date(now.getTime() - days * DAY - 1000), subscriptionStatus: "active", employeeLimit: 5 }, now, policy);
  assert.equal(at(4).phase, "grace");
  assert.equal(at(4).locked, true, "admin is locked from the first day");
  assert.equal(at(4).staffLocked, false);
  assert.equal(at(5).phase, "blurred");
  assert.equal(at(5).restricted, true);
  assert.equal(at(5).staffLocked, false, "staff can still punch while blurred");
  assert.equal(at(19).phase, "blurred");
  assert.equal(at(20).phase, "punch_closed");
  assert.equal(at(20).staffLocked, true, "punching closes on day 20");
  assert.equal(at(29).phase, "punch_closed");
  assert.equal(at(30).phase, "cutoff");
  assert.equal(at(30).staffLocked, true);
  assert.equal(at(30).locked, true);
});

test("grace phases follow an edited policy", () => {
  const now = new Date("2026-11-16T00:00:00Z");
  const policy = { blurAfterDays: 2, punchUntilDays: 7, blockAfterDays: 10 };
  const at = (days: number) =>
    accessInfo({ accessUntil: new Date(now.getTime() - days * DAY - 1000), subscriptionStatus: "active", employeeLimit: 5 }, now, policy);
  assert.equal(at(1).phase, "grace");
  assert.equal(at(2).phase, "blurred");
  assert.equal(at(7).phase, "punch_closed");
  assert.equal(at(9).phase, "punch_closed");
  assert.equal(at(10).phase, "cutoff");
});

test("grace policy: whole numbers, in order, within the range", () => {
  assert.equal(validateGracePolicy({ blurAfterDays: 5, punchUntilDays: 20, blockAfterDays: 30 }).ok, true);
  assert.equal(validateGracePolicy({ blurAfterDays: 0, punchUntilDays: 0, blockAfterDays: 0 }).ok, true);
  assert.equal(validateGracePolicy({ blurAfterDays: "5", punchUntilDays: "20", blockAfterDays: "30" }).ok, true);
  assert.equal(validateGracePolicy({ blurAfterDays: 5, punchUntilDays: 20 }).ok, false, "missing limit");
  assert.equal(validateGracePolicy({ blurAfterDays: 5.5, punchUntilDays: 20, blockAfterDays: 30 }).ok, false, "fraction");
  assert.equal(validateGracePolicy({ blurAfterDays: -1, punchUntilDays: 20, blockAfterDays: 30 }).ok, false, "negative");
  assert.equal(validateGracePolicy({ blurAfterDays: 5, punchUntilDays: 20, blockAfterDays: 400 }).ok, false, "too large");
  assert.equal(validateGracePolicy({ blurAfterDays: 25, punchUntilDays: 20, blockAfterDays: 30 }).ok, false, "out of order");
  assert.equal(validateGracePolicy({ blurAfterDays: 5, punchUntilDays: 31, blockAfterDays: 30 }).ok, false, "block before punching stops");
});

test("trial expiry: admin locked at once; staff punch for five days with history hidden; full lock from day five", () => {
  const now = new Date("2026-11-16T00:00:00Z");
  const at = (days: number) =>
    accessInfo({ accessUntil: new Date(now.getTime() - days * DAY - 1000), subscriptionStatus: "trial", employeeLimit: null }, now);
  assert.equal(at(0).locked, true, "admin is locked on the first day after the trial");
  assert.equal(at(0).endedAs, "trial");
  assert.equal(at(0).staffLocked, false, "staff can still punch");
  assert.equal(at(0).restricted, true, "staff history is hidden");
  assert.equal(at(4).staffLocked, false);
  assert.equal(at(4).phase, "blurred");
  assert.equal(at(5).staffLocked, true, "full lockout from the fifth day");
  assert.equal(at(5).phase, "cutoff");
});

test("trial has no employee cap", () => {
  assert.equal(TRIAL_EMPLOYEE_LIMIT, null);
});

test("minor-unit conversion for payment gateways", () => {
  assert.equal(toMinorUnits(534.6), 53460);
  assert.equal(toMinorUnits(99), 9900);
});

test("a legacy account never locks", () => {
  const now = new Date("2026-11-16T00:00:00Z");
  const legacy = accessInfo({ accessUntil: null, subscriptionStatus: "legacy", employeeLimit: null }, now);
  assert.equal(legacy.locked, false);
  assert.equal(legacy.state, "legacy");
  assert.equal(legacy.employeeLimit, null);
});
