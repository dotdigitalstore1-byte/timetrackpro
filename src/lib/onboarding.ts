// Expert Onboarding service: pricing from Superadmin settings, paid requests, the shared specialist queue with
// atomic claims, release/flag/complete, user ratings with the 24h reminder and 48h auto-complete, earnings, and
// platform monitoring. Business rules live in onboarding-core.ts; this file does the database work.
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  companies,
  onboardingEvents,
  onboardingRequests,
  onboardingSettings,
  onboardingSpecialists,
  onboardingTiers,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { toMinorUnits } from "@/lib/billing-core";
import { isRealSecret, razorpayPaymentSignatureValid } from "@/lib/payments-core";
import {
  AUTO_COMPLETE_AFTER_HOURS,
  DEFAULT_AUTO_SATISFACTION,
  OnboardingValidationError,
  SATISFACTION_BENCHMARK,
  commissionAmountFor,
  commissionPercentFor,
  isDelayed,
  monthlyBreakdown,
  normalizeContact,
  quoteOnboarding,
  ratingStage,
  validateSatisfaction,
  type ContactInput,
  type Quote,
} from "@/lib/onboarding-core";
import type { NotificationItem } from "@/lib/notifications";

export class OnboardingError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const HOUR = 3_600_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Converts core validation errors into API errors with a 400 status. */
function asApiError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof OnboardingValidationError) throw new OnboardingError(e.message, 400);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Settings and slabs (Superadmin configuration)
// ---------------------------------------------------------------------------

export interface SettingsDto {
  baseFee: number;
  defaultCommissionPercent: number;
}

export interface TierDto {
  id: string;
  maxEmployees: number | null;
  pricePerEmployee: number;
}

export async function loadSettings(): Promise<SettingsDto> {
  const [row] = await db.select().from(onboardingSettings).where(eq(onboardingSettings.id, 1)).limit(1);
  if (row) return { baseFee: Number(row.baseFee), defaultCommissionPercent: Number(row.defaultCommissionPercent) };
  await db.insert(onboardingSettings).values({ id: 1 }).onConflictDoNothing();
  return { baseFee: 0, defaultCommissionPercent: 10 };
}

export async function loadTiers(): Promise<TierDto[]> {
  const rows = await db.select().from(onboardingTiers).orderBy(asc(onboardingTiers.sortOrder));
  return rows.map((r) => ({
    id: r.id,
    maxEmployees: r.maxEmployees,
    pricePerEmployee: Number(r.pricePerEmployee),
  }));
}

/** Public price list for the company form. Prices always come from the stored configuration. */
export async function priceList() {
  const [settings, tiers] = await Promise.all([loadSettings(), loadTiers()]);
  return { baseFee: settings.baseFee, tiers };
}

export async function updateSettings(input: { baseFee: unknown; defaultCommissionPercent: unknown }, actorId: string): Promise<SettingsDto> {
  const baseFee = Number(input.baseFee);
  const pct = Number(input.defaultCommissionPercent);
  if (!Number.isFinite(baseFee) || baseFee < 0 || baseFee > 10_000_000) throw new OnboardingError("Base fee must be zero or more.");
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new OnboardingError("Default commission must be between 0 and 100.");
  await loadSettings();
  await db
    .update(onboardingSettings)
    .set({ baseFee: String(round2(baseFee)), defaultCommissionPercent: String(round2(pct)), updatedAt: new Date(), updatedBy: actorId })
    .where(eq(onboardingSettings.id, 1));
  return loadSettings();
}

/**
 * Replaces the employee slabs. Rules: at least one tier; prices above zero; bounds unique; at most one open-ended tier,
 * which must be the last one (it catches every headcount above the largest bound).
 */
export async function replaceTiers(input: unknown[]): Promise<TierDto[]> {
  if (!Array.isArray(input) || input.length === 0) throw new OnboardingError("Add at least one employee pricing slab.");
  const parsed = input.map((raw) => {
    const r = raw as { maxEmployees?: unknown; pricePerEmployee?: unknown };
    const price = Number(r.pricePerEmployee);
    if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) throw new OnboardingError("Each slab needs a per-employee price above zero.");
    if (r.maxEmployees === null || r.maxEmployees === "" || r.maxEmployees === undefined) {
      return { maxEmployees: null as number | null, pricePerEmployee: round2(price) };
    }
    const max = Number(r.maxEmployees);
    if (!Number.isInteger(max) || max < 1 || max > 100_000) throw new OnboardingError("Employee thresholds must be whole numbers from 1 upward.");
    return { maxEmployees: max, pricePerEmployee: round2(price) };
  });
  const open = parsed.filter((p) => p.maxEmployees === null);
  if (open.length > 1) throw new OnboardingError("Only one slab can be open-ended (above the largest threshold).");
  const bounded = parsed.filter((p) => p.maxEmployees !== null).map((p) => p.maxEmployees as number);
  if (new Set(bounded).size !== bounded.length) throw new OnboardingError("Each threshold can only be used once.");
  const sorted = [...parsed].sort((a, b) => (a.maxEmployees ?? Infinity) - (b.maxEmployees ?? Infinity));

  await db.transaction(async (tx) => {
    await tx.delete(onboardingTiers);
    await tx.insert(onboardingTiers).values(
      sorted.map((t, i) => ({
        maxEmployees: t.maxEmployees,
        pricePerEmployee: String(t.pricePerEmployee), // numeric column: Drizzle expects a string
        sortOrder: i + 1,
      }))
    );
  });
  return loadTiers();
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

async function logEvent(requestId: string, event: string, actorId: string | null, note?: string) {
  await db.insert(onboardingEvents).values({ requestId, event, actorId, note: note ?? null });
}

/**
 * Auto-completes requests that the user has not rated within the window. Idempotent: a row is changed only while it is
 * still awaiting a rating. Runs whenever a list is loaded, so no separate scheduler is required.
 */
export async function sweepAutoComplete(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - AUTO_COMPLETE_AFTER_HOURS * HOUR);
  const done = await db
    .update(onboardingRequests)
    .set({
      status: "completed",
      satisfaction: DEFAULT_AUTO_SATISFACTION,
      ratedAt: now,
      ratingSource: "auto",
    })
    .where(and(eq(onboardingRequests.status, "awaiting_rating"), lte(onboardingRequests.completedAt, cutoff)))
    .returning({ id: onboardingRequests.id });
  for (const r of done) await logEvent(r.id, "auto_completed", null, `No rating after ${AUTO_COMPLETE_AFTER_HOURS} hours; recorded as ${DEFAULT_AUTO_SATISFACTION}%.`);
  return done.length;
}

// ---------------------------------------------------------------------------
// Company side: quote, pay, track, rate
// ---------------------------------------------------------------------------

export interface OrderInput {
  companyId: string;
  userId: string;
  includeOnboarding: boolean;
  includeEmployees: boolean;
  employeeCount: number;
  contact: ContactInput;
}

async function quoteNow(input: Pick<OrderInput, "includeOnboarding" | "includeEmployees" | "employeeCount">): Promise<Quote> {
  const [settings, tiers] = await Promise.all([loadSettings(), loadTiers()]);
  return asApiError(() =>
    quoteOnboarding({
      includeOnboarding: input.includeOnboarding,
      includeEmployees: input.includeEmployees,
      employeeCount: input.employeeCount,
      baseFee: settings.baseFee,
      tiers,
    })
  );
}

/** Quote for the company form, before any contact details are entered. */
export async function quoteForCompany(input: { includeOnboarding: boolean; includeEmployees: boolean; employeeCount: number }) {
  return quoteNow(input);
}

/** True when Razorpay keys are configured. Onboarding uses Razorpay directly, so it does not depend on PAYMENT_PROVIDER. */
export function onboardingPaymentsEnabled(): boolean {
  return isRealSecret(process.env.RAZORPAY_KEY_ID) && isRealSecret(process.env.RAZORPAY_KEY_SECRET);
}

function razorpayKeys() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!isRealSecret(keyId) || !isRealSecret(keySecret)) {
    throw new OnboardingError("Online payments are not available yet. Please contact support.", 503);
  }
  return { keyId: keyId!, keySecret: keySecret! };
}

/**
 * Starts a paid onboarding request: the server prices it, stores the contact details, and creates a gateway order.
 * The request stays out of the specialist queue until the payment is captured.
 */
export async function createOnboardingOrder(input: OrderInput) {
  const { keyId, keySecret } = razorpayKeys();
  const contact = asApiError(() => normalizeContact(input.contact));
  const quote = await quoteNow(input);

  const [company] = await db.select().from(companies).where(eq(companies.id, input.companyId)).limit(1);
  const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!company || !user) throw new OnboardingError("Account not found.", 404);

  const [row] = await db
    .insert(onboardingRequests)
    .values({
      companyId: company.id,
      requestedBy: user.id,
      includeOnboarding: input.includeOnboarding,
      includeEmployees: input.includeEmployees,
      employeeCount: quote.employeeCount,
      baseFee: String(quote.baseFee),
      employeeFee: String(quote.employeeFee),
      totalAmount: String(quote.total),
      contactWhatsapp: contact.whatsapp,
      contactEmail: contact.email,
      contactCall: contact.call,
      status: "pending_payment",
    })
    .returning();

  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: toMinorUnits(quote.total),
      currency: "INR",
      receipt: row.id,
      notes: { onboardingRequestId: row.id, companyId: company.id },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const order = (await res.json().catch(() => ({}))) as { id?: string };
  if (!res.ok || !order.id) {
    console.error("onboarding order failed", res.status);
    throw new OnboardingError("The payment provider could not start this payment. Please try again.", 502);
  }
  await db.update(onboardingRequests).set({ providerOrderId: order.id }).where(eq(onboardingRequests.id, row.id));
  await logEvent(row.id, "placed", user.id, `Order for ₹${quote.total.toFixed(2)} created.`);

  return {
    requestId: row.id,
    orderId: order.id,
    amountRupees: quote.total,
    quote,
    razorpay: {
      keyId,
      amountMinor: toMinorUnits(quote.total),
      currency: "INR",
      name: "TimeTrack Pro",
      description: "Expert Onboarding",
      prefill: {
        name: user.fullName,
        email: contact.email,
        contact: contact.whatsapp,
      },
    },
  };
}

/** Moves a request into the shared queue once its payment is captured. Idempotent and safe against concurrent deliveries. */
async function fulfillRequest(requestId: string, paymentId: string | null, paidRupees: number): Promise<"paid" | "already_paid"> {
  const [row] = await db.select().from(onboardingRequests).where(eq(onboardingRequests.id, requestId)).limit(1);
  if (!row) throw new OnboardingError("Request not found.", 404);
  if (row.status !== "pending_payment") return "already_paid";
  if (round2(paidRupees) !== round2(Number(row.totalAmount))) {
    throw new OnboardingError("The amount paid does not match the price. The request was not placed in the queue.", 400);
  }
  // Conditional update: only one delivery (browser or webhook) can move the row out of pending_payment.
  const moved = await db
    .update(onboardingRequests)
    .set({ status: "open", providerPaymentId: paymentId, paidAt: new Date() })
    .where(and(eq(onboardingRequests.id, requestId), eq(onboardingRequests.status, "pending_payment")))
    .returning({ id: onboardingRequests.id });
  if (moved.length === 0) return "already_paid";
  await logEvent(requestId, "paid", null, `Payment captured${paymentId ? ` (${paymentId})` : ""}. Added to the specialist queue.`);
  return "paid";
}

/** Browser-side confirmation after checkout. The signature and the gateway's record are both checked before the queue is fed. */
export async function confirmOnboardingPayment(args: { companyId: string; orderId: string; paymentId: string; signature: string }) {
  const { keyId, keySecret } = razorpayKeys();
  const [row] = await db
    .select()
    .from(onboardingRequests)
    .where(and(eq(onboardingRequests.companyId, args.companyId), eq(onboardingRequests.providerOrderId, args.orderId)))
    .limit(1);
  if (!row) throw new OnboardingError("Request not found.", 404);
  if (row.status !== "pending_payment") return "already_paid" as const;
  if (!razorpayPaymentSignatureValid(args.orderId, args.paymentId, args.signature, keySecret)) {
    throw new OnboardingError("Payment could not be verified.");
  }
  const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(args.paymentId)}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}` },
    signal: AbortSignal.timeout(15_000),
  });
  const payment = (await res.json().catch(() => ({}))) as { status?: string; amount?: number; order_id?: string };
  if (!res.ok || payment.order_id !== args.orderId) throw new OnboardingError("Payment could not be verified.");
  if (payment.status !== "captured") return "pending" as const;
  return fulfillRequest(row.id, args.paymentId, Number(payment.amount) / 100);
}

/**
 * Razorpay webhook path (payment.captured for an order that is not a subscription). Returns false if the order is not
 * an onboarding order, so the caller can ignore it.
 */
export async function onboardingWebhookCaptured(orderId: string, paymentId: string, paidRupees: number): Promise<boolean> {
  const [row] = await db.select().from(onboardingRequests).where(eq(onboardingRequests.providerOrderId, orderId)).limit(1);
  if (!row) return false;
  await fulfillRequest(row.id, paymentId, paidRupees);
  return true;
}

export interface CompanyRequestDto {
  id: string;
  createdAt: string;
  paidAt: string | null;
  includeOnboarding: boolean;
  includeEmployees: boolean;
  employeeCount: number;
  total: number;
  status: string;
  specialistName: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  satisfaction: number | null;
  ratingSource: string | null;
  canRate: boolean;
  ratingReminder: boolean;
}

export async function companyRequests(companyId: string): Promise<CompanyRequestDto[]> {
  await sweepAutoComplete();
  const now = new Date();
  const rows = await db
    .select({ r: onboardingRequests, specialistName: users.fullName })
    .from(onboardingRequests)
    .leftJoin(users, eq(users.id, onboardingRequests.specialistId))
    .where(and(eq(onboardingRequests.companyId, companyId), sql`${onboardingRequests.status} <> 'pending_payment'`))
    .orderBy(desc(onboardingRequests.createdAt))
    .limit(100);
  return rows.map(({ r, specialistName }) => {
    const awaiting = r.status === "awaiting_rating" && r.completedAt;
    const stage = awaiting ? ratingStage(r.completedAt!, now) : null;
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      paidAt: r.paidAt?.toISOString() ?? null,
      includeOnboarding: r.includeOnboarding,
      includeEmployees: r.includeEmployees,
      employeeCount: r.employeeCount,
      total: Number(r.totalAmount),
      status: r.status,
      specialistName: r.specialistId ? specialistName ?? "Specialist" : null,
      claimedAt: r.claimedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      satisfaction: r.satisfaction,
      ratingSource: r.ratingSource,
      canRate: !!awaiting,
      ratingReminder: stage === "reminder",
    };
  });
}

export async function rateRequest(companyId: string, requestId: string, value: unknown): Promise<void> {
  const satisfaction = asApiError(() => validateSatisfaction(value));
  const updated = await db
    .update(onboardingRequests)
    .set({ status: "completed", satisfaction, ratedAt: new Date(), ratingSource: "user" })
    .where(
      and(
        eq(onboardingRequests.id, requestId),
        eq(onboardingRequests.companyId, companyId),
        eq(onboardingRequests.status, "awaiting_rating")
      )
    )
    .returning({ id: onboardingRequests.id });
  if (updated.length === 0) {
    throw new OnboardingError("This request is not waiting for a rating (it may already be rated or auto-completed).", 409);
  }
  await logEvent(requestId, "rated", null, `Satisfaction ${satisfaction}%.`);
}

/** Bell items for the company admin: accepted by a specialist, and the rating prompt / reminder. */
export async function companyNotifications(companyId: string, seenAt: Date): Promise<NotificationItem[]> {
  await sweepAutoComplete();
  const since = new Date(Date.now() - 90 * 24 * HOUR);
  const rows = await db
    .select({ r: onboardingRequests, name: users.fullName })
    .from(onboardingRequests)
    .leftJoin(users, eq(users.id, onboardingRequests.specialistId))
    .where(
      and(
        eq(onboardingRequests.companyId, companyId),
        isNotNull(onboardingRequests.claimedAt),
        gte(onboardingRequests.createdAt, since)
      )
    )
    .orderBy(desc(onboardingRequests.createdAt))
    .limit(30);

  const items: NotificationItem[] = [];
  const now = new Date();
  for (const { r, name } of rows) {
    const specialist = name ?? "one of our specialists";
    if (r.claimedAt) {
      items.push({
        id: `onboarding-accepted:${r.id}`,
        kind: "onboarding",
        title: "Expert Onboarding accepted",
        body: `Your Expert Onboarding request has been accepted by ${specialist}. They will contact you shortly.`,
        at: r.claimedAt.toISOString(),
        unread: r.claimedAt > seenAt,
        tone: "green",
        href: "/onboarding",
      });
    }
    if (r.status === "awaiting_rating" && r.completedAt) {
      const stage = ratingStage(r.completedAt, now);
      items.push({
        id: `onboarding-rate:${r.id}`,
        kind: "onboarding",
        title: stage === "reminder" ? "Reminder: rate your onboarding" : "Rate your Expert Onboarding",
        body: "Your specialist has marked the setup complete. How satisfied are you? Your rating helps us improve.",
        at: r.completedAt.toISOString(),
        unread: true,
        tone: "amber",
        href: "/onboarding",
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Specialist side: queue, claim, release, flag, complete, earnings
// ---------------------------------------------------------------------------

async function specialistRate(specialistId: string): Promise<{ percent: number; override: number | null }> {
  const settings = await loadSettings();
  const [profile] = await db
    .select()
    .from(onboardingSpecialists)
    .where(eq(onboardingSpecialists.userId, specialistId))
    .limit(1);
  const override = profile?.commissionPercent !== null && profile?.commissionPercent !== undefined ? Number(profile.commissionPercent) : null;
  return { percent: commissionPercentFor(override, settings.defaultCommissionPercent), override };
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/**
 * The specialist's dashboard. Open requests show the service, amount and commission only; the client's company name and
 * contact details are revealed to the specialist who claimed the request, and only while they hold it.
 */
export async function specialistQueue(specialistId: string) {
  await sweepAutoComplete();
  const { percent } = await specialistRate(specialistId);
  const now = new Date();

  const openRows = await db
    .select()
    .from(onboardingRequests)
    .where(eq(onboardingRequests.status, "open"))
    .orderBy(asc(onboardingRequests.paidAt))
    .limit(200);

  const mineRows = await db
    .select({ r: onboardingRequests, companyName: companies.name })
    .from(onboardingRequests)
    .innerJoin(companies, eq(companies.id, onboardingRequests.companyId))
    .where(and(eq(onboardingRequests.specialistId, specialistId), inArray(onboardingRequests.status, ["claimed", "awaiting_rating", "completed"])))
    .orderBy(desc(onboardingRequests.claimedAt))
    .limit(200);

  const completedMine = await db
    .select()
    .from(onboardingRequests)
    .where(and(eq(onboardingRequests.specialistId, specialistId), isNotNull(onboardingRequests.completedAt)));
  const thisMonth = monthKey(now);
  const monthRows = monthlyBreakdown(
    completedMine.map((r) => ({
      specialistId,
      completedAt: r.completedAt!,
      satisfaction: r.satisfaction,
      commissionAmount: r.commissionAmount !== null ? Number(r.commissionAmount) : null,
    })),
    thisMonth
  );
  const me = monthRows[0];

  return {
    commissionPercent: percent,
    benchmark: SATISFACTION_BENCHMARK,
    earnings: {
      month: thisMonth,
      completed: me?.completed ?? 0,
      commission: me?.commission ?? 0,
      averageSatisfaction: me?.averageSatisfaction ?? null,
      belowBenchmark: me?.belowBenchmark ?? false,
    },
    open: openRows.map((r) => {
      const amount = Number(r.totalAmount);
      return {
        id: r.id,
        paidAt: r.paidAt?.toISOString() ?? null,
        includeOnboarding: r.includeOnboarding,
        includeEmployees: r.includeEmployees,
        employeeCount: r.employeeCount,
        total: amount,
        commissionPercent: percent,
        commissionAmount: commissionAmountFor(amount, percent),
        releaseCount: r.releaseCount,
      };
    }),
    mine: mineRows.map(({ r, companyName }) => {
      const amount = Number(r.totalAmount);
      const active = r.status === "claimed";
      return {
        id: r.id,
        status: r.status,
        claimedAt: r.claimedAt?.toISOString() ?? null,
        completedAt: r.completedAt?.toISOString() ?? null,
        includeOnboarding: r.includeOnboarding,
        includeEmployees: r.includeEmployees,
        employeeCount: r.employeeCount,
        total: amount,
        commissionPercent: r.commissionPercent !== null ? Number(r.commissionPercent) : percent,
        commissionAmount: r.commissionAmount !== null ? Number(r.commissionAmount) : null,
        satisfaction: r.satisfaction,
        flagReason: r.flagReason,
        delayed: active && r.claimedAt ? isDelayed(r.claimedAt, now) : false,
        // Contact details only while the specialist holds the request.
        client: active
          ? { companyName, whatsapp: r.contactWhatsapp, email: r.contactEmail, call: r.contactCall }
          : null,
      };
    }),
  };
}

export async function claimRequest(specialistId: string, requestId: string): Promise<void> {
  const { percent } = await specialistRate(specialistId);
  // Atomic: only one specialist can flip the row from open to claimed.
  const claimed = await db
    .update(onboardingRequests)
    .set({
      status: "claimed",
      specialistId,
      claimedAt: new Date(),
      commissionPercent: String(percent),
      flagReason: null,
      flaggedAt: null,
    })
    .where(and(eq(onboardingRequests.id, requestId), eq(onboardingRequests.status, "open")))
    .returning({ id: onboardingRequests.id });
  if (claimed.length === 0) throw new OnboardingError("This request was already claimed or is no longer open.", 409);
  await logEvent(requestId, "claimed", specialistId, "Accepted by specialist.");
}

export async function releaseRequest(specialistId: string, requestId: string, note: string | undefined): Promise<void> {
  const released = await db
    .update(onboardingRequests)
    .set({
      status: "open",
      specialistId: null,
      claimedAt: null,
      commissionPercent: null,
      releaseCount: sql`${onboardingRequests.releaseCount} + 1`,
      flagReason: null,
      flaggedAt: null,
    })
    .where(
      and(
        eq(onboardingRequests.id, requestId),
        eq(onboardingRequests.status, "claimed"),
        eq(onboardingRequests.specialistId, specialistId)
      )
    )
    .returning({ id: onboardingRequests.id });
  if (released.length === 0) throw new OnboardingError("Only the specialist who holds this request can release it.", 409);
  await logEvent(requestId, "released", specialistId, (note ?? "").trim().slice(0, 500) || "Released back to the queue.");
}

export async function flagRequest(specialistId: string, requestId: string, reason: string): Promise<void> {
  const text = (reason ?? "").trim();
  if (text.length < 3 || text.length > 500) throw new OnboardingError("Describe the issue in 3 to 500 characters.");
  const flagged = await db
    .update(onboardingRequests)
    .set({ flagReason: text, flaggedAt: new Date() })
    .where(
      and(
        eq(onboardingRequests.id, requestId),
        eq(onboardingRequests.status, "claimed"),
        eq(onboardingRequests.specialistId, specialistId)
      )
    )
    .returning({ id: onboardingRequests.id });
  if (flagged.length === 0) throw new OnboardingError("Only the specialist who holds this request can flag it.", 409);
  await logEvent(requestId, "flagged", specialistId, text);
}

/** Marks the setup complete. Commission is fixed at this point from the rate snapshotted when the request was claimed. */
export async function completeRequest(specialistId: string, requestId: string): Promise<void> {
  const [row] = await db
    .select()
    .from(onboardingRequests)
    .where(and(eq(onboardingRequests.id, requestId), eq(onboardingRequests.specialistId, specialistId)))
    .limit(1);
  if (!row || row.status !== "claimed") throw new OnboardingError("Only a request you have claimed and not yet completed can be marked complete.", 409);
  const percent = row.commissionPercent !== null ? Number(row.commissionPercent) : (await specialistRate(specialistId)).percent;
  const amount = commissionAmountFor(Number(row.totalAmount), percent);
  const now = new Date();
  const done = await db
    .update(onboardingRequests)
    .set({ status: "awaiting_rating", completedAt: now, commissionPercent: String(percent), commissionAmount: String(amount) })
    .where(and(eq(onboardingRequests.id, requestId), eq(onboardingRequests.status, "claimed")))
    .returning({ id: onboardingRequests.id });
  if (done.length === 0) throw new OnboardingError("This request changed while you were working on it. Refresh and try again.", 409);
  await logEvent(requestId, "completed", specialistId, "Marked complete. Waiting for the client's rating.");
}

// ---------------------------------------------------------------------------
// Superadmin: specialists, monitoring, payouts
// ---------------------------------------------------------------------------

export interface SpecialistRow {
  userId: string;
  fullName: string;
  email: string;
  phone: string;
  photoDataUrl: string | null;
  isActive: boolean;
  commissionOverride: number | null;
  effectiveCommission: number;
  activeClaims: number;
  completed: number;
  averageSatisfaction: number | null;
  commissionThisMonth: number;
  createdAt: string;
}

export async function listSpecialists(): Promise<SpecialistRow[]> {
  await sweepAutoComplete();
  const settings = await loadSettings();
  const rows = await db
    .select({ u: users, p: onboardingSpecialists })
    .from(users)
    .leftJoin(onboardingSpecialists, eq(onboardingSpecialists.userId, users.id))
    .where(eq(users.role, "onboarding_specialist"))
    .orderBy(asc(users.fullName));
  const ids = rows.map((r) => r.u.id);
  const reqs = ids.length
    ? await db
        .select()
        .from(onboardingRequests)
        .where(inArray(onboardingRequests.specialistId, ids))
    : [];
  const month = monthKey(new Date());

  return rows.map(({ u, p }) => {
    const mine = reqs.filter((r) => r.specialistId === u.id);
    const monthly = monthlyBreakdown(
      mine
        .filter((r) => r.completedAt)
        .map((r) => ({
          specialistId: u.id,
          completedAt: r.completedAt!,
          satisfaction: r.satisfaction,
          commissionAmount: r.commissionAmount !== null ? Number(r.commissionAmount) : null,
        })),
      month
    )[0];
    const override = p?.commissionPercent !== null && p?.commissionPercent !== undefined ? Number(p.commissionPercent) : null;
    return {
      userId: u.id,
      fullName: u.fullName,
      email: u.email,
      phone: p?.phone ?? "",
      photoDataUrl: p?.photoDataUrl ?? null,
      isActive: u.isActive,
      commissionOverride: override,
      effectiveCommission: commissionPercentFor(override, settings.defaultCommissionPercent),
      activeClaims: mine.filter((r) => r.status === "claimed").length,
      completed: mine.filter((r) => r.completedAt).length,
      averageSatisfaction: (() => {
        const scores = mine.map((r) => r.satisfaction).filter((s): s is number => s !== null);
        return scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
      })(),
      commissionThisMonth: monthly?.commission ?? 0,
      createdAt: u.createdAt.toISOString(),
    };
  });
}

export async function createSpecialist(input: {
  fullName: string;
  email: string;
  password: string;
  phone: string;
  photoDataUrl?: string | null;
  commissionPercent?: number | null;
}): Promise<string> {
  const fullName = (input.fullName ?? "").trim();
  if (fullName.length < 2 || fullName.length > 200) throw new OnboardingError("Enter the specialist's full name.");
  const email = (input.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw new OnboardingError("Enter a valid email address.");
  if (!input.password || input.password.length < 8) throw new OnboardingError("The password must be at least 8 characters.");
  const phone = normalizePhoneOrThrow(input.phone);
  const photo = normalizePhoto(input.photoDataUrl);
  const commission = normalizeCommission(input.commissionPercent);

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length) throw new OnboardingError("An account with this email already exists.", 409);

  const created = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email,
        passwordHash: hashPassword(input.password),
        fullName,
        role: "onboarding_specialist",
        companyId: null,
        phone,
      })
      .returning();
    await tx.insert(onboardingSpecialists).values({
      userId: user.id,
      phone,
      photoDataUrl: photo,
      commissionPercent: commission === null ? null : String(commission),
    });
    return user;
  });
  return created.id;
}

export async function updateSpecialist(
  userId: string,
  input: { commissionPercent?: unknown; isActive?: unknown; phone?: unknown; photoDataUrl?: unknown; password?: unknown },
  actorId: string
): Promise<void> {
  const [user] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.role, "onboarding_specialist"))).limit(1);
  if (!user) throw new OnboardingError("Specialist not found.", 404);

  const profileUpdate: Partial<{ commissionPercent: string | null; phone: string; photoDataUrl: string | null }> = {};
  if (input.commissionPercent !== undefined) {
    const c = normalizeCommission(input.commissionPercent as number | null);
    profileUpdate.commissionPercent = c === null ? null : String(c);
  }
  if (input.phone !== undefined) profileUpdate.phone = normalizePhoneOrThrow(String(input.phone));
  if (input.photoDataUrl !== undefined) profileUpdate.photoDataUrl = normalizePhoto(input.photoDataUrl as string | null);

  await db.transaction(async (tx) => {
    if (Object.keys(profileUpdate).length) {
      await tx.update(onboardingSpecialists).set(profileUpdate).where(eq(onboardingSpecialists.userId, userId));
    }
    const userUpdate: Partial<{ isActive: boolean; passwordHash: string }> = {};
    if (typeof input.isActive === "boolean") userUpdate.isActive = input.isActive;
    if (typeof input.password === "string" && input.password.length > 0) {
      if (input.password.length < 8) throw new OnboardingError("The password must be at least 8 characters.");
      userUpdate.passwordHash = hashPassword(input.password);
    }
    if (Object.keys(userUpdate).length) {
      await tx.update(users).set(userUpdate).where(eq(users.id, userId));
    }
  });

  // A deactivated specialist's open work goes back to the queue, so no client is left without anyone.
  if (input.isActive === false) {
    const freed = await db
      .update(onboardingRequests)
      .set({ status: "open", specialistId: null, claimedAt: null, commissionPercent: null, releaseCount: sql`${onboardingRequests.releaseCount} + 1` })
      .where(and(eq(onboardingRequests.specialistId, userId), eq(onboardingRequests.status, "claimed")))
      .returning({ id: onboardingRequests.id });
    for (const r of freed) await logEvent(r.id, "released", actorId, "Specialist deactivated by the platform owner.");
  }
}

function normalizePhoneOrThrow(raw: string): string {
  const digits = (raw ?? "").trim().replace(/[\s\-()]/g, "");
  if (!/^\+?\d{10,15}$/.test(digits)) throw new OnboardingError("Enter a valid phone number (10 to 15 digits).");
  return digits;
}

function normalizePhoto(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(raw)) throw new OnboardingError("The photo must be a PNG, JPEG or WebP image.");
  if (raw.length > 300_000) throw new OnboardingError("The photo is too large. Use a smaller image.");
  return raw;
}

function normalizeCommission(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined || (raw as unknown) === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new OnboardingError("Commission must be between 0 and 100 percent.");
  return round2(n);
}

export interface MonitorRow {
  id: string;
  status: string;
  companyName: string;
  specialistName: string | null;
  total: number;
  includeOnboarding: boolean;
  includeEmployees: boolean;
  employeeCount: number;
  createdAt: string;
  paidAt: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  releaseCount: number;
  flagReason: string | null;
  flaggedAt: string | null;
  delayed: boolean;
  ratingStage: "waiting" | "reminder" | "auto_complete" | null;
  satisfaction: number | null;
  ratingSource: string | null;
  commissionAmount: number | null;
}

export async function monitorRequests(): Promise<{ rows: MonitorRow[]; counts: Record<string, number>; released: number; flagged: number; delayed: number }> {
  await sweepAutoComplete();
  const now = new Date();
  const data = await db
    .select({ r: onboardingRequests, companyName: companies.name, specialistName: users.fullName })
    .from(onboardingRequests)
    .innerJoin(companies, eq(companies.id, onboardingRequests.companyId))
    .leftJoin(users, eq(users.id, onboardingRequests.specialistId))
    .where(sql`${onboardingRequests.status} <> 'pending_payment'`)
    .orderBy(desc(onboardingRequests.createdAt))
    .limit(500);

  const counts: Record<string, number> = { open: 0, claimed: 0, awaiting_rating: 0, completed: 0 };
  let released = 0;
  let flagged = 0;
  let delayed = 0;
  const rows = data.map(({ r, companyName, specialistName }) => {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    released += r.releaseCount;
    const late = r.status === "claimed" && !!r.claimedAt && isDelayed(r.claimedAt, now);
    if (r.flagReason) flagged += 1;
    if (late) delayed += 1;
    return {
      id: r.id,
      status: r.status,
      companyName,
      specialistName: specialistName ?? null,
      total: Number(r.totalAmount),
      includeOnboarding: r.includeOnboarding,
      includeEmployees: r.includeEmployees,
      employeeCount: r.employeeCount,
      createdAt: r.createdAt.toISOString(),
      paidAt: r.paidAt?.toISOString() ?? null,
      claimedAt: r.claimedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      releaseCount: r.releaseCount,
      flagReason: r.flagReason,
      flaggedAt: r.flaggedAt?.toISOString() ?? null,
      delayed: late,
      ratingStage: r.status === "awaiting_rating" && r.completedAt ? ratingStage(r.completedAt, now) : null,
      satisfaction: r.satisfaction,
      ratingSource: r.ratingSource,
      commissionAmount: r.commissionAmount !== null ? Number(r.commissionAmount) : null,
    };
  });
  return { rows, counts, released, flagged, delayed };
}

/** Per-specialist monthly split for payouts. `month` is "YYYY-MM". */
export async function monthlyPayouts(month: string) {
  await sweepAutoComplete();
  const specialists = await db
    .select({ id: users.id, name: users.fullName, email: users.email })
    .from(users)
    .where(eq(users.role, "onboarding_specialist"));
  const done = await db
    .select()
    .from(onboardingRequests)
    .where(isNotNull(onboardingRequests.completedAt));
  const rows = monthlyBreakdown(
    done
      .filter((r) => r.specialistId)
      .map((r) => ({
        specialistId: r.specialistId!,
        completedAt: r.completedAt!,
        satisfaction: r.satisfaction,
        commissionAmount: r.commissionAmount !== null ? Number(r.commissionAmount) : null,
      })),
    month
  );
  const byId = new Map(specialists.map((s) => [s.id, s]));
  return rows.map((r) => ({
    ...r,
    name: byId.get(r.specialistId)?.name ?? "Specialist",
    email: byId.get(r.specialistId)?.email ?? "",
  }));
}
