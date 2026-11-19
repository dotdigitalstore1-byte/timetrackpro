// Expert Onboarding: pure rules (pricing, commission, ratings, timing). No database or framework imports, so the
// same functions are used by the API routes, the UI previews and the unit tests.

/** Satisfaction benchmark for specialist performance (0-100). */
export const SATISFACTION_BENCHMARK = 60;
/** The user is reminded this many hours after completion if they have not rated. */
export const RATING_REMINDER_AFTER_HOURS = 24;
/** Unrated requests are completed automatically this many hours after the specialist marks them complete. */
export const AUTO_COMPLETE_AFTER_HOURS = 48;
/**
 * Rating recorded automatically when the user does not respond. Set to the benchmark so an unrated request
 * neither inflates nor blocks a specialist's record; it is stored with source "auto" so it is always distinguishable.
 */
export const DEFAULT_AUTO_SATISFACTION = SATISFACTION_BENCHMARK;

export const ONBOARDING_STATUSES = ["pending_payment", "open", "claimed", "awaiting_rating", "completed"] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export interface TierInput {
  /** Inclusive upper bound on the headcount; null = no upper bound (the last tier). */
  maxEmployees: number | null;
  pricePerEmployee: number;
}

export interface QuoteInput {
  includeOnboarding: boolean;
  includeEmployees: boolean;
  employeeCount: number;
  baseFee: number;
  tiers: TierInput[];
}

export interface Quote {
  baseFee: number;
  employeeCount: number;
  /** Rate applied to every employee, from the slab the headcount falls in (all-units pricing). */
  employeeRate: number;
  employeeFee: number;
  total: number;
  tierLabel: string;
}

export class OnboardingValidationError extends Error {}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The slab a headcount falls into. Tiers are checked from the smallest bound up; a null bound catches the rest. */
export function tierFor(count: number, tiers: TierInput[]): TierInput | null {
  const sorted = [...tiers].sort((a, b) => {
    if (a.maxEmployees === null) return 1;
    if (b.maxEmployees === null) return -1;
    return a.maxEmployees - b.maxEmployees;
  });
  return sorted.find((t) => t.maxEmployees === null || count <= t.maxEmployees) ?? null;
}

function tierLabelOf(count: number, tier: TierInput, all: TierInput[]): string {
  const sorted = [...all].sort((a, b) => (a.maxEmployees ?? Infinity) - (b.maxEmployees ?? Infinity));
  const lower = sorted.filter((t) => t.maxEmployees !== null && t.maxEmployees < (tier.maxEmployees ?? Infinity));
  const floor = lower.length ? (lower[lower.length - 1].maxEmployees as number) + 1 : 1;
  return tier.maxEmployees === null ? `${floor}+ employees` : `${floor}–${tier.maxEmployees} employees`;
}

/**
 * Prices an order from the Superadmin configuration. The browser never supplies prices: the server calls this
 * with stored values and charges the result.
 */
export function quoteOnboarding(input: QuoteInput): Quote {
  if (!input.includeOnboarding && !input.includeEmployees) {
    throw new OnboardingValidationError("Choose at least one service.");
  }
  if (input.includeEmployees) {
    if (!Number.isInteger(input.employeeCount) || input.employeeCount < 1) {
      throw new OnboardingValidationError("Enter how many employees you want added.");
    }
  }
  const baseFee = input.includeOnboarding ? round2(input.baseFee) : 0;
  if (input.includeOnboarding && !(baseFee > 0)) {
    throw new OnboardingValidationError("Onboarding pricing is not set up yet. Please contact support.");
  }

  let employeeRate = 0;
  let employeeFee = 0;
  let tierLabel = "";
  let employeeCount = 0;
  if (input.includeEmployees) {
    const tier = tierFor(input.employeeCount, input.tiers);
    if (!tier || !(tier.pricePerEmployee > 0)) {
      throw new OnboardingValidationError("Employee pricing is not set up yet. Please contact support.");
    }
    employeeCount = input.employeeCount;
    employeeRate = round2(tier.pricePerEmployee);
    employeeFee = round2(employeeRate * employeeCount);
    tierLabel = tierLabelOf(employeeCount, tier, input.tiers);
  }

  return {
    baseFee,
    employeeCount,
    employeeRate,
    employeeFee,
    total: round2(baseFee + employeeFee),
    tierLabel,
  };
}

/** The specialist's own rate if the Superadmin set one, otherwise the global default. */
export function commissionPercentFor(specialistPercent: number | null | undefined, defaultPercent: number): number {
  return specialistPercent !== null && specialistPercent !== undefined ? specialistPercent : defaultPercent;
}

export function commissionAmountFor(amount: number, percent: number): number {
  return round2((amount * percent) / 100);
}

export function validateSatisfaction(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    throw new OnboardingValidationError("Satisfaction must be a whole number from 0 to 100.");
  }
  return n;
}

export function meetsBenchmark(satisfaction: number): boolean {
  return satisfaction >= SATISFACTION_BENCHMARK;
}

/** Phone numbers: optional leading +, 10 to 15 digits. Spaces, dashes and brackets are ignored. */
export function normalizePhone(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  const digits = trimmed.replace(/[\s\-()]/g, "");
  if (!/^\+?\d{10,15}$/.test(digits)) return null;
  return digits;
}

export function normalizeEmail(raw: string): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (v.length > 200) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

export interface ContactInput {
  whatsapp: string;
  email: string;
  call: string;
  /** Checked box: "Same as WhatsApp number". */
  callSameAsWhatsapp: boolean;
}

export function normalizeContact(input: ContactInput): { whatsapp: string; email: string; call: string } {
  const whatsapp = normalizePhone(input.whatsapp);
  if (!whatsapp) throw new OnboardingValidationError("Enter a valid WhatsApp number (10 to 15 digits).");
  const email = normalizeEmail(input.email);
  if (!email) throw new OnboardingValidationError("Enter a valid email address.");
  const call = input.callSameAsWhatsapp ? whatsapp : normalizePhone(input.call);
  if (!call) throw new OnboardingValidationError("Enter a valid calling number (10 to 15 digits).");
  return { whatsapp, email, call };
}

export type RatingStage = "waiting" | "reminder" | "auto_complete";

/** Where an unrated, completed request stands at `now`. */
export function ratingStage(completedAt: Date, now: Date): RatingStage {
  const hours = (now.getTime() - completedAt.getTime()) / 3_600_000;
  if (hours >= AUTO_COMPLETE_AFTER_HOURS) return "auto_complete";
  if (hours >= RATING_REMINDER_AFTER_HOURS) return "reminder";
  return "waiting";
}

/** A claimed request that has been open longer than the auto-complete window without being completed. */
export function isDelayed(claimedAt: Date, now: Date): boolean {
  return (now.getTime() - claimedAt.getTime()) / 3_600_000 >= AUTO_COMPLETE_AFTER_HOURS;
}

export interface MonthlyInput {
  specialistId: string;
  completedAt: Date;
  satisfaction: number | null;
  commissionAmount: number | null;
}

export interface MonthlyRow {
  specialistId: string;
  completed: number;
  rated: number;
  averageSatisfaction: number | null;
  commission: number;
  belowBenchmark: boolean;
}

/** Monthly split for payouts. `month` is "YYYY-MM" in UTC. Requests without a satisfaction score count as completed only. */
export function monthlyBreakdown(rows: MonthlyInput[], month: string): MonthlyRow[] {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new OnboardingValidationError("Month must look like 2026-11.");
  const bySpecialist = new Map<string, { completed: number; scores: number[]; commission: number }>();
  for (const r of rows) {
    if (r.completedAt.toISOString().slice(0, 7) !== month) continue;
    const agg = bySpecialist.get(r.specialistId) ?? { completed: 0, scores: [], commission: 0 };
    agg.completed += 1;
    if (r.satisfaction !== null) agg.scores.push(r.satisfaction);
    agg.commission += r.commissionAmount ?? 0;
    bySpecialist.set(r.specialistId, agg);
  }
  return [...bySpecialist.entries()]
    .map(([specialistId, agg]) => {
      const avg = agg.scores.length ? agg.scores.reduce((a, b) => a + b, 0) / agg.scores.length : null;
      return {
        specialistId,
        completed: agg.completed,
        rated: agg.scores.length,
        averageSatisfaction: avg === null ? null : Math.round(avg * 10) / 10,
        commission: round2(agg.commission),
        belowBenchmark: avg !== null && avg < SATISFACTION_BENCHMARK,
      };
    })
    .sort((a, b) => b.commission - a.commission);
}
