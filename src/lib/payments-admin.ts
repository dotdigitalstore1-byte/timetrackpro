// Platform-owner queries for the Payments report. Every function here is for the super admin only; the route handlers check that.
import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { companies, payments, plans, users } from "@/db/schema";
import { quoteCycle } from "@/lib/billing-core";
import {
  COLLECTED_DB_STATUSES,
  DB_STATUSES,
  displayStatus,
  istDateKey,
  istDayStartOf,
  istMonthStartOf,
  methodLabel,
  type GatewayDetails,
  type KpiSummary,
  type PaymentDetail,
  type PaymentEvent,
  type PaymentFilters,
  type TransactionRow,
  type TrendPoint,
} from "@/lib/payments-report";

const DAY_MS = 86_400_000;
/** The date a transaction is listed under: the capture time, or the start time when it never captured. */
const TXN_DATE = sql`coalesce(${payments.paidAt}, ${payments.createdAt})`;
const COLLECTED_SQL = sql`${payments.status} in ('paid', 'refunded', 'partially_refunded')`;

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);
const toNumber = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Builds the WHERE clause for the list and the export. The company join must be part of the query. */
export function paymentConditions(f: PaymentFilters): SQL | undefined {
  const conditions: SQL[] = [];
  if (f.from) conditions.push(gte(TXN_DATE, f.from));
  if (f.to) conditions.push(lt(TXN_DATE, f.to));
  if (f.status !== "all") conditions.push(inArray(payments.status, DB_STATUSES[f.status]));
  if (f.planId) conditions.push(eq(payments.planId, f.planId));
  if (f.q) {
    const pattern = `%${escapeLike(f.q)}%`;
    const match = or(
      ilike(companies.name, pattern),
      ilike(companies.code, pattern),
      ilike(payments.providerPaymentId, pattern),
      ilike(payments.providerOrderId, pattern)
    );
    if (match) conditions.push(match);
  }
  return conditions.length ? and(...conditions) : undefined;
}

const LIST_FIELDS = {
  payment: payments,
  companyName: companies.name,
  companyCode: companies.code,
  planName: plans.name,
};

function toRow(r: { payment: typeof payments.$inferSelect; companyName: string; companyCode: string | null; planName: string | null }): TransactionRow {
  const p = r.payment;
  const status = displayStatus(p.status);
  return {
    id: p.id,
    date: (p.paidAt ?? p.createdAt).toISOString(),
    companyId: p.companyId,
    companyName: r.companyName,
    companyCode: r.companyCode,
    planName: r.planName,
    months: p.months,
    provider: p.provider,
    amount: round2(Number(p.amount)),
    refundedAmount: round2(Number(p.refundedAmount)),
    status: p.status,
    statusKey: status.key,
    statusLabel: status.label,
    method: p.paymentMethod,
    methodLabel: methodLabel(p.paymentMethod),
    providerPaymentId: p.providerPaymentId,
    providerOrderId: p.providerOrderId,
  };
}

/** One page of transactions, newest first, plus the total that matches the filters. */
export async function listPayments(f: PaymentFilters, page: number, pageSize: number) {
  const where = paymentConditions(f);
  const base = () =>
    db
      .select(LIST_FIELDS)
      .from(payments)
      .innerJoin(companies, eq(companies.id, payments.companyId))
      .leftJoin(plans, eq(plans.id, payments.planId))
      .where(where);

  const rows = await base().orderBy(desc(TXN_DATE), desc(payments.id)).limit(pageSize + 1).offset(page * pageSize);
  const [{ n }] = await db
    .select({ n: count() })
    .from(payments)
    .innerJoin(companies, eq(companies.id, payments.companyId))
    .leftJoin(plans, eq(plans.id, payments.planId))
    .where(where);

  const hasMore = rows.length > pageSize;
  return {
    transactions: rows.slice(0, pageSize).map(toRow),
    total: toNumber(n),
    hasMore,
  };
}

/** Every matching transaction for the CSV export, newest first. The caller enforces the size limit. */
export async function exportRows(f: PaymentFilters, limit: number) {
  const rows = await db
    .select({ ...LIST_FIELDS, createdBy: users.fullName })
    .from(payments)
    .innerJoin(companies, eq(companies.id, payments.companyId))
    .leftJoin(plans, eq(plans.id, payments.planId))
    .leftJoin(users, eq(users.id, payments.createdBy))
    .where(paymentConditions(f))
    .orderBy(desc(TXN_DATE), desc(payments.id))
    .limit(limit);
  return rows;
}

export async function countPayments(f: PaymentFilters): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(payments)
    .innerJoin(companies, eq(companies.id, payments.companyId))
    .leftJoin(plans, eq(plans.id, payments.planId))
    .where(paymentConditions(f));
  return toNumber(n);
}

/** Platform-wide headline numbers. These ignore the table filters so the top of the page always answers the same questions. */
export async function paymentSummary(now: Date): Promise<KpiSummary> {
  const todayStart = istDayStartOf(now);
  const monthStart = istMonthStartOf(now);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const failedSql = sql`${payments.status} = 'failed' and ${payments.createdAt} >= ${since30}`;
  const pendingSql = sql`${payments.status} in ('created', 'processing') and ${payments.createdAt} >= ${since30}`;

  const [row] = await db
    .select({
      todayAmount: sql<string>`coalesce(sum(${payments.amount}) filter (where ${COLLECTED_SQL} and ${payments.paidAt} >= ${todayStart}), 0)`,
      todayCount: sql<number>`count(*) filter (where ${COLLECTED_SQL} and ${payments.paidAt} >= ${todayStart})`,
      monthAmount: sql<string>`coalesce(sum(${payments.amount}) filter (where ${COLLECTED_SQL} and ${payments.paidAt} >= ${monthStart}), 0)`,
      monthCount: sql<number>`count(*) filter (where ${COLLECTED_SQL} and ${payments.paidAt} >= ${monthStart})`,
      lifetimeGross: sql<string>`coalesce(sum(${payments.amount}) filter (where ${COLLECTED_SQL}), 0)`,
      lifetimeRefunded: sql<string>`coalesce(sum(${payments.refundedAmount}) filter (where ${COLLECTED_SQL}), 0)`,
      lifetimeCount: sql<number>`count(*) filter (where ${COLLECTED_SQL})`,
      failedAmount: sql<string>`coalesce(sum(${payments.amount}) filter (where ${failedSql}), 0)`,
      failedCount: sql<number>`count(*) filter (where ${failedSql})`,
      pendingAmount: sql<string>`coalesce(sum(${payments.amount}) filter (where ${pendingSql}), 0)`,
      pendingCount: sql<number>`count(*) filter (where ${pendingSql})`,
    })
    .from(payments);

  const gross = round2(toNumber(row.lifetimeGross));
  const refunded = round2(toNumber(row.lifetimeRefunded));
  const failed = { count: toNumber(row.failedCount), amount: round2(toNumber(row.failedAmount)) };
  const pending = { count: toNumber(row.pendingCount), amount: round2(toNumber(row.pendingAmount)) };

  return {
    today: { amount: round2(toNumber(row.todayAmount)), count: toNumber(row.todayCount) },
    month: { amount: round2(toNumber(row.monthAmount)), count: toNumber(row.monthCount) },
    lifetime: { gross, refunded, net: round2(gross - refunded), count: toNumber(row.lifetimeCount) },
    open: {
      days: 30,
      count: failed.count + pending.count,
      amount: round2(failed.amount + pending.amount),
      failed,
      pending,
    },
  };
}

const DAY_EXPR = sql`to_char(${payments.paidAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`;
const MONTH_EXPR = sql`to_char(${payments.paidAt} at time zone 'Asia/Kolkata', 'YYYY-MM')`;

/** Collected revenue per IST day for the last 30 days and per IST month for the last 12, with empty periods filled in. */
export async function revenueTrend(now: Date): Promise<{ daily: TrendPoint[]; monthly: TrendPoint[] }> {
  const dayStart = istDayStartOf(new Date(now.getTime() - 29 * DAY_MS));
  const monthStart = istMonthStartOf(now, -11);

  const dayRows = await db
    .select({ key: DAY_EXPR, amount: sql<string>`sum(${payments.amount})`, n: count() })
    .from(payments)
    .where(and(inArray(payments.status, COLLECTED_DB_STATUSES), gte(payments.paidAt, dayStart)))
    .groupBy(DAY_EXPR);

  const monthRows = await db
    .select({ key: MONTH_EXPR, amount: sql<string>`sum(${payments.amount})`, n: count() })
    .from(payments)
    .where(and(inArray(payments.status, COLLECTED_DB_STATUSES), gte(payments.paidAt, monthStart)))
    .groupBy(MONTH_EXPR);

  const dayMap = new Map(dayRows.map((r) => [r.key, { amount: round2(toNumber(r.amount)), count: toNumber(r.n) }]));
  const monthMap = new Map(monthRows.map((r) => [r.key, { amount: round2(toNumber(r.amount)), count: toNumber(r.n) }]));

  const daily: TrendPoint[] = [];
  for (let i = 0; i < 30; i++) {
    const instant = new Date(dayStart.getTime() + i * DAY_MS + 1);
    const key = istDateKey(instant);
    const hit = dayMap.get(key) ?? { amount: 0, count: 0 };
    daily.push({ key, label: dayLabel(key), ...hit });
  }

  const monthly: TrendPoint[] = [];
  for (let i = 0; i < 12; i++) {
    const start = istMonthStartOf(now, i - 11);
    // The first instant of an IST month is 18:30 UTC on the last day of the previous month, so +1 ms lands inside it.
    const key = istDateKey(new Date(start.getTime() + 1)).slice(0, 7);
    const hit = monthMap.get(key) ?? { amount: 0, count: 0 };
    monthly.push({ key, label: monthLabel(key), ...hit });
  }

  return { daily, monthly };
}

function dayLabel(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

function monthLabel(key: string): string {
  return new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export async function listPlansForFilter() {
  return db.select({ id: plans.id, name: plans.name }).from(plans).orderBy(asc(plans.sortOrder), asc(plans.name));
}

/** Full breakdown of one payment, including the gateway log. Null when the payment does not exist. */
export async function paymentDetail(id: string): Promise<PaymentDetail | null> {
  const [row] = await db
    .select({
      payment: payments,
      companyName: companies.name,
      companyCode: companies.code,
      companyEmail: companies.email,
      planName: plans.name,
      planPrice: plans.price,
      planSeats: plans.employeeLimit,
      initiatorName: users.fullName,
      initiatorEmail: users.email,
    })
    .from(payments)
    .innerJoin(companies, eq(companies.id, payments.companyId))
    .leftJoin(plans, eq(plans.id, payments.planId))
    .leftJoin(users, eq(users.id, payments.createdBy))
    .where(eq(payments.id, id))
    .limit(1);
  if (!row) return null;

  const p = row.payment;
  const status = displayStatus(p.status);
  const amount = round2(Number(p.amount));
  const refundedAmount = round2(Number(p.refundedAmount));
  const discountPercent = Number(p.discountPercent);

  // The stored amount is what was charged. The list price is re-derived from the plan, so the discount line shows what
  // the customer saved. If the plan has since been removed, the breakdown falls back to the amount alone.
  let listTotal: number | null = null;
  let discountAmount: number | null = null;
  if (row.planPrice !== null) {
    const quote = quoteCycle({ price: Number(row.planPrice), compareAtPrice: null }, p.months, discountPercent);
    listTotal = quote.listTotal;
    discountAmount = round2(Math.max(0, quote.listTotal - amount));
  }

  // Only plain values from the gateway log are shown. Anything else is ignored rather than rendered.
  const meta = (p.gatewayMeta ?? {}) as Record<string, unknown>;
  const events: PaymentEvent[] = Array.isArray(meta.events) ? (meta.events as PaymentEvent[]) : [];
  const gatewayFields: GatewayDetails = {};
  for (const [key, value] of Object.entries(meta)) {
    if (key !== "events" && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
      gatewayFields[key] = value;
    }
  }

  return {
    id: p.id,
    date: (p.paidAt ?? p.createdAt).toISOString(),
    createdAt: p.createdAt.toISOString(),
    paidAt: p.paidAt ? p.paidAt.toISOString() : null,
    provider: p.provider,
    status: p.status,
    statusKey: status.key,
    statusLabel: status.label,
    amount,
    refundedAmount,
    netAmount: round2(amount - refundedAmount),
    months: p.months,
    discountPercent,
    listTotal,
    discountAmount,
    planName: row.planName,
    planSeats: row.planSeats,
    method: p.paymentMethod,
    methodLabel: methodLabel(p.paymentMethod),
    providerPaymentId: p.providerPaymentId,
    providerOrderId: p.providerOrderId,
    company: { id: p.companyId, name: row.companyName, code: row.companyCode, email: row.companyEmail },
    initiatedBy: row.initiatorName && row.initiatorEmail ? { name: row.initiatorName, email: row.initiatorEmail } : null,
    gateway: gatewayFields,
    events: [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)),
  };
}

/** Largest number of rows one export may return. Bigger requests must narrow the filters first. */
export const EXPORT_LIMIT = 5000;
