// Pure billing rules: pricing maths, access state, seat limits and input validation.
// No imports on purpose, so the same code runs on the server, in client components and under `node --test`.

export const DAY_MS = 86_400_000;
export const TRIAL_DAYS = 20;
export const TRIAL_EMPLOYEE_LIMIT = 4;

/** Every feature ships on every plan. The only thing a plan limits is the number of seats. */
export const PLATFORM_FEATURES = [
  "Photo-verified punch in/out with GPS geofencing",
  "Leave management with approval workflow",
  "Payroll, salary slips and payment holds",
  "Rules for late marks, half days, overtime and deductions",
  "Unlimited departments, locations and shifts",
  "Managers with their own permissions",
  "Reports exported to Excel, CSV and PDF",
  "Company agreements and notice periods",
  "Installable mobile app and web app",
  "Historical data kept for the life of your account",
];

/** Launch price list (INR per month for the whole tier). Seeded once; the platform admin edits it afterwards. */
export const DEFAULT_PLANS: { name: string; employeeLimit: number; price: number }[] = [
  { name: "Solo", employeeLimit: 1, price: 99 },
  { name: "Duo", employeeLimit: 2, price: 200 },
  { name: "Trio", employeeLimit: 3, price: 300 },
  { name: "Quad", employeeLimit: 4, price: 400 },
  { name: "Team 5", employeeLimit: 5, price: 500 },
  { name: "Team 10", employeeLimit: 10, price: 900 },
  { name: "Team 20", employeeLimit: 20, price: 1749 },
  { name: "Team 30", employeeLimit: 30, price: 2499 },
  { name: "Business 50", employeeLimit: 50, price: 2999 },
  { name: "Business 100", employeeLimit: 100, price: 7999 },
];

/** Discounts for longer commitments. Assumed starting values; the platform admin changes them. */
export const DEFAULT_CYCLES: { months: number; label: string; discountPercent: number }[] = [
  { months: 1, label: "1 month", discountPercent: 0 },
  { months: 6, label: "6 months", discountPercent: 10 },
  { months: 12, label: "12 months", discountPercent: 20 },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- pricing

export interface CycleQuote {
  months: number;
  discountPercent: number;
  /** Price for the whole period before discount. */
  listTotal: number;
  /** Price for the whole period after discount, rounded to whole rupees. */
  total: number;
  /** Effective monthly price across the period. */
  perMonth: number;
  /** Rupees saved against the list price. */
  savings: number;
  /** Crossed-out per-month figure to show next to perMonth, or null when there is nothing to compare. */
  strikePerMonth: number | null;
}

export function quoteCycle(
  plan: { price: number; compareAtPrice: number | null },
  months: number,
  discountPercent: number
): CycleQuote {
  const listTotal = round2(plan.price * months);
  const total = Math.round(plan.price * months * (1 - discountPercent / 100));
  const perMonth = round2(total / months);
  const savings = round2(Math.max(0, listTotal - total));
  let strikePerMonth: number | null = null;
  if (plan.compareAtPrice !== null) strikePerMonth = plan.compareAtPrice;
  else if (discountPercent > 0) strikePerMonth = plan.price;
  return { months, discountPercent, listTotal, total, perMonth, savings, strikePerMonth };
}

/** Calendar-month arithmetic in UTC. 31 Jan + 1 month = 28/29 Feb. */
export function addMonths(from: Date, months: number): Date {
  const day = from.getUTCDate();
  const d = new Date(from.getTime());
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** The tier a company with `headcount` people needs: the smallest plan whose seats cover it. */
export function toMinorUnits(rupees: number): number {
  return Math.round(rupees * 100);
}

export function tierFor<T extends { employeeLimit: number }>(plans: T[], headcount: number): T | null {
  const sorted = [...plans].sort((a, b) => a.employeeLimit - b.employeeLimit);
  return sorted.find((p) => p.employeeLimit >= Math.max(1, headcount)) ?? null;
}

// ---------------------------------------------------------------- access

/** Staff keep punching for the whole grace window. Their history is hidden from day 5, and access ends on day 30. */
export const GRACE_BLUR_AFTER_DAYS = 5;
export const HARD_CUTOFF_DAYS = 30;

export type AccessState = "trial" | "active" | "legacy" | "expired";

/**
 * trial / active / legacy : normal operation.
 * trial_expired          : trial ended. Everyone is locked out until the company subscribes (no grace on trials).
 * grace                  : a paid period ended less than 5 days ago. Admin is locked out; staff carry on as normal.
 * blurred                : 5 to 29 days after a paid expiry. Staff can still punch; their history is hidden.
 * cutoff                 : 30+ days after a paid expiry. Staff are locked out too.
 */
export type Phase = "trial" | "active" | "legacy" | "trial_expired" | "grace" | "blurred" | "cutoff";

export interface AccessInfo {
  state: AccessState;
  phase: Phase;
  /** The company admin is locked out (any expiry). */
  locked: boolean;
  /** Employees and managers are locked out (trial ended, or hard cutoff). */
  staffLocked: boolean;
  /** Employees' personal history is hidden (blurred phase). */
  restricted: boolean;
  daysLeft: number | null;
  daysSinceExpiry: number | null;
  /** When locked: did the lockout follow a trial or a paid period? */
  endedAs: "trial" | "paid" | null;
  /** Seat limit, or null for unlimited. */
  employeeLimit: number | null;
}

export function accessInfo(
  company: { accessUntil: Date | null; subscriptionStatus: string; employeeLimit: number | null },
  now: Date
): AccessInfo {
  const employeeLimit = company.employeeLimit;
  if (!company.accessUntil) {
    return { state: "legacy", phase: "legacy", locked: false, staffLocked: false, restricted: false, daysLeft: null, daysSinceExpiry: null, endedAs: null, employeeLimit };
  }
  const trial = company.subscriptionStatus === "trial";
  const untilMs = company.accessUntil.getTime();
  const nowMs = now.getTime();
  if (untilMs > nowMs) {
    return {
      state: trial ? "trial" : "active",
      phase: trial ? "trial" : "active",
      locked: false,
      staffLocked: false,
      restricted: false,
      daysLeft: Math.ceil((untilMs - nowMs) / DAY_MS),
      daysSinceExpiry: null,
      endedAs: null,
      employeeLimit,
    };
  }
  const daysSinceExpiry = Math.floor((nowMs - untilMs) / DAY_MS);
  if (trial) {
    return { state: "expired", phase: "trial_expired", locked: true, staffLocked: true, restricted: false, daysLeft: 0, daysSinceExpiry, endedAs: "trial", employeeLimit };
  }
  const phase: Phase =
    daysSinceExpiry < GRACE_BLUR_AFTER_DAYS ? "grace" : daysSinceExpiry < HARD_CUTOFF_DAYS ? "blurred" : "cutoff";
  return {
    state: "expired",
    phase,
    locked: true,
    staffLocked: phase === "cutoff",
    restricted: phase === "blurred",
    daysLeft: 0,
    daysSinceExpiry,
    endedAs: "paid",
    employeeLimit,
  };
}

/** Can `adding` more people join? `limit` null means unlimited. */
export function seatCheck(
  limit: number | null,
  used: number,
  adding: number
): { ok: true } | { ok: false; available: number } {
  if (limit === null) return { ok: true };
  const available = Math.max(0, limit - used);
  return adding <= available ? { ok: true } : { ok: false, available };
}

/** Whether a company may activate a plan itself. Production needs an explicit opt-in until a payment gateway is connected. */
export function canSelfActivate(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV !== "production" || env.BILLING_MANUAL_ACTIVATION === "true";
}

// ---------------------------------------------------------------- validation

type Body = Record<string, unknown>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface PlanInput {
  name: string;
  employeeLimit: number;
  price: number;
  compareAtPrice: number | null;
  features: string[];
  isActive: boolean;
  sortOrder: number;
}

export function validatePlanInput(body: Body): Result<PlanInput> {
  const name = String(body.name ?? "").trim();
  if (!name || name.length > 60) return { ok: false, error: "Plan name is required (up to 60 characters)." };

  const employeeLimit = Number(body.employeeLimit);
  if (!Number.isInteger(employeeLimit) || employeeLimit < 1 || employeeLimit > 10_000) {
    return { ok: false, error: "Employee limit must be a whole number between 1 and 10,000." };
  }

  const price = Number(body.price);
  if (!Number.isFinite(price) || price <= 0 || price > 10_000_000) {
    return { ok: false, error: "Price must be a positive amount." };
  }

  let compareAtPrice: number | null = null;
  if (body.compareAtPrice !== undefined && body.compareAtPrice !== null && String(body.compareAtPrice).trim() !== "") {
    compareAtPrice = Number(body.compareAtPrice);
    if (!Number.isFinite(compareAtPrice) || compareAtPrice <= price) {
      return { ok: false, error: "The 'compare at' price must be higher than the active price (or left empty)." };
    }
    compareAtPrice = round2(compareAtPrice);
  }

  const rawFeatures = Array.isArray(body.features)
    ? body.features.map((f) => String(f))
    : String(body.features ?? "").split(/\r?\n/);
  const features = rawFeatures.map((f) => f.trim()).filter(Boolean);
  if (features.length > 20) return { ok: false, error: "A plan can list up to 20 features." };
  if (features.some((f) => f.length > 140)) return { ok: false, error: "Each feature must be 140 characters or fewer." };

  const sortOrder = body.sortOrder === undefined || body.sortOrder === "" ? 0 : Number(body.sortOrder);
  if (!Number.isInteger(sortOrder) || Math.abs(sortOrder) > 10_000) {
    return { ok: false, error: "Sort order must be a whole number." };
  }

  return {
    ok: true,
    value: {
      name,
      employeeLimit,
      price: round2(price),
      compareAtPrice,
      features,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      sortOrder,
    },
  };
}

export interface CycleInput {
  months: number;
  label: string;
  discountPercent: number;
  isActive: boolean;
}

export function validateCycleInput(body: Body): Result<CycleInput> {
  const months = Number(body.months);
  if (!Number.isInteger(months) || months < 1 || months > 36) {
    return { ok: false, error: "Billing length must be a whole number of months (1 to 36)." };
  }
  const discountPercent = body.discountPercent === undefined || body.discountPercent === "" ? 0 : Number(body.discountPercent);
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 90) {
    return { ok: false, error: "Discount must be between 0% and 90%." };
  }
  const label = String(body.label ?? "").trim() || `${months} ${months === 1 ? "month" : "months"}`;
  if (label.length > 60) return { ok: false, error: "Label must be 60 characters or fewer." };
  return {
    ok: true,
    value: { months, label, discountPercent: round2(discountPercent), isActive: body.isActive === undefined ? true : Boolean(body.isActive) },
  };
}
