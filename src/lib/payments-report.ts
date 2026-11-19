// Pure helpers for the platform Payments report: calendar ranges in India Standard Time, status labels, gateway
// metadata extraction and CSV output. No database or framework imports, so every rule is covered by fixed-vector tests.

/** India has no daylight saving time, so IST is a fixed UTC+05:30 offset. */
export const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
const DAY_MS = 86_400_000;
/** Custom ranges are capped so an export cannot quietly cover many years. */
export const MAX_CUSTOM_SPAN_DAYS = 370;

export type RangeKey = "today" | "7d" | "month" | "custom";
export const RANGE_KEYS: readonly RangeKey[] = ["today", "7d", "month", "custom"];

export type StatusKey = "captured" | "failed" | "refunded" | "pending";
export const STATUS_KEYS: readonly StatusKey[] = ["captured", "failed", "refunded", "pending"];

/** Stored payment statuses behind each status the report shows. */
export const DB_STATUSES: Record<StatusKey, string[]> = {
  captured: ["paid"],
  failed: ["failed"],
  refunded: ["refunded", "partially_refunded"],
  pending: ["created", "processing"],
};

/** Money was collected from the customer. Refunded payments still count here: they were collected first. */
export const COLLECTED_DB_STATUSES = ["paid", "refunded", "partially_refunded"];

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/** The wall-clock fields of an instant in IST, read through UTC getters. */
function istParts(instant: Date) {
  return new Date(instant.getTime() + IST_OFFSET_MS);
}

/** "YYYY-MM-DD" for the IST calendar day that contains the instant. */
export function istDateKey(instant: Date): string {
  const s = istParts(instant);
  return `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())}`;
}

/** The instant at which the IST calendar day containing `instant` begins. */
export function istDayStartOf(instant: Date): Date {
  const s = istParts(instant);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - IST_OFFSET_MS);
}

/** The instant at which an IST calendar month begins. `monthOffset` moves relative to the instant's month. */
export function istMonthStartOf(instant: Date, monthOffset = 0): Date {
  const s = istParts(instant);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + monthOffset, 1) - IST_OFFSET_MS);
}

/** Parses "YYYY-MM-DD" as an IST calendar day. Returns null for anything that is not a real date. */
export function parseIstDay(key: string | null | undefined): Date | null {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [y, m, d] = key.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return new Date(utc - IST_OFFSET_MS);
}

export interface RangeBounds {
  /** Inclusive start, or null for no lower bound. */
  from: Date | null;
  /** Exclusive end, or null for "up to now". */
  to: Date | null;
}

/**
 * Turns a range choice into bounds. "today", "7d" (today and the six days before) and "month" are relative to now in IST.
 * Custom bounds are inclusive IST calendar days, so the end date includes that whole day.
 */
export function resolveRange(
  range: RangeKey,
  now: Date,
  customFrom?: string | null,
  customTo?: string | null
): RangeBounds | { error: string } {
  if (range === "today") {
    const from = istDayStartOf(now);
    return { from, to: new Date(from.getTime() + DAY_MS) };
  }
  if (range === "7d") return { from: new Date(istDayStartOf(now).getTime() - 6 * DAY_MS), to: null };
  if (range === "month") return { from: istMonthStartOf(now), to: null };

  const from = parseIstDay(customFrom);
  const lastDay = parseIstDay(customTo);
  if (!from || !lastDay) return { error: "Choose both a start and an end date." };
  if (lastDay.getTime() < from.getTime()) return { error: "The end date must be on or after the start date." };
  const spanDays = (lastDay.getTime() - from.getTime()) / DAY_MS + 1;
  if (spanDays > MAX_CUSTOM_SPAN_DAYS) return { error: `Custom ranges can cover at most ${MAX_CUSTOM_SPAN_DAYS} days.` };
  return { from, to: new Date(lastDay.getTime() + DAY_MS) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return !!value && UUID.test(value);
}

export interface PaymentFilters extends RangeBounds {
  range: RangeKey;
  status: StatusKey | "all";
  planId: string | null;
  /** Trimmed search text, capped in length. */
  q: string;
}

/** Reads the filters from a URL query. Unknown values fall back to safe defaults. Invalid dates return an error. */
export function parsePaymentFilters(params: URLSearchParams, now: Date): PaymentFilters | { error: string } {
  const rawRange = params.get("range") ?? "month";
  const range = (RANGE_KEYS as readonly string[]).includes(rawRange) ? (rawRange as RangeKey) : "month";
  const rawStatus = params.get("status") ?? "all";
  const status = rawStatus === "all" || (STATUS_KEYS as readonly string[]).includes(rawStatus) ? (rawStatus as StatusKey | "all") : "all";
  const planRaw = params.get("planId");
  const planId = isUuid(planRaw) ? planRaw : null;
  const q = (params.get("q") ?? "").trim().slice(0, 80);

  const bounds = resolveRange(range, now, params.get("from"), params.get("to"));
  if ("error" in bounds) return bounds;
  return { ...bounds, range, status, planId, q };
}

export interface StatusView {
  key: StatusKey;
  label: string;
}

/** Maps a stored payment status onto the four statuses the report shows. */
export function displayStatus(dbStatus: string): StatusView {
  switch (dbStatus) {
    case "paid":
      return { key: "captured", label: "Captured" };
    case "failed":
      return { key: "failed", label: "Failed" };
    case "refunded":
      return { key: "refunded", label: "Refunded" };
    case "partially_refunded":
      return { key: "refunded", label: "Partially refunded" };
    default:
      // created and processing: the customer has not finished paying yet.
      return { key: "pending", label: "Pending" };
  }
}

const METHOD_LABELS: Record<string, string> = {
  upi: "UPI",
  card: "Card",
  credit_card: "Card",
  debit_card: "Card",
  netbanking: "Netbanking",
  net_banking: "Netbanking",
  wallet: "Wallet",
  emi: "EMI",
  paylater: "Pay later",
  cod: "Cash on delivery",
};

/** A human label for a payment method, e.g. "upi" → "UPI". Null when the gateway did not send one. */
export function methodLabel(method: string | null | undefined): string {
  if (!method) return "—";
  const known = METHOD_LABELS[method.toLowerCase()];
  if (known) return known;
  return method.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Razorpay's payment entity, limited to the fields we read. Amounts arrive in paise. */
export interface RazorpayPaymentEntity {
  id?: string;
  order_id?: string;
  method?: string;
  status?: string;
  amount?: number;
  amount_refunded?: number;
  fee?: number;
  tax?: number;
  bank?: string | null;
  wallet?: string | null;
  vpa?: string | null;
  international?: boolean;
  refund_status?: string | null;
  error_code?: string | null;
  error_description?: string | null;
  error_reason?: string | null;
  error_source?: string | null;
  error_step?: string | null;
  created_at?: number;
  card?: { network?: string; last4?: string; type?: string; issuer?: string | null } | null;
}

/** What we keep from the gateway: no names, contact details, full card numbers or full UPI IDs. */
export type GatewayDetails = Record<string, string | number | boolean>;

/** Masks a UPI ID so support can recognise it without storing the full handle: "name@bank" → "n***@bank". */
export function maskVpa(vpa: string): string {
  const at = vpa.indexOf("@");
  if (at <= 0) return "***";
  return `${vpa.slice(0, 1)}***${vpa.slice(at)}`;
}

const rupees = (paise: number | undefined) => (typeof paise === "number" ? Math.round(paise) / 100 : undefined);

/** Keeps the useful, non-sensitive parts of a Razorpay payment. Empty values are dropped. */
export function razorpayGatewayDetails(entity: RazorpayPaymentEntity): GatewayDetails {
  const out: Record<string, string | number | boolean | undefined | null> = {
    paymentId: entity.id,
    orderId: entity.order_id,
    method: entity.method,
    status: entity.status,
    fee: rupees(entity.fee),
    tax: rupees(entity.tax),
    bank: entity.bank,
    wallet: entity.wallet,
    vpa: entity.vpa ? maskVpa(entity.vpa) : undefined,
    cardNetwork: entity.card?.network,
    cardType: entity.card?.type,
    cardIssuer: entity.card?.issuer ?? undefined,
    cardLast4: entity.card?.last4,
    international: entity.international,
    refundStatus: entity.refund_status ?? undefined,
    amountRefunded: rupees(entity.amount_refunded),
    gatewayCreatedAt: typeof entity.created_at === "number" ? new Date(entity.created_at * 1000).toISOString() : undefined,
    errorCode: entity.error_code ?? undefined,
    errorDescription: entity.error_description ?? undefined,
    errorReason: entity.error_reason ?? undefined,
    errorSource: entity.error_source ?? undefined,
    errorStep: entity.error_step ?? undefined,
  };
  const clean: GatewayDetails = {};
  for (const [k, v] of Object.entries(out)) {
    if (v !== undefined && v !== null && v !== "") clean[k] = v;
  }
  return clean;
}

/** IST wall-clock timestamp for exports and labels, e.g. "2026-11-19 14:05". */
export function istDateTime(instant: Date): string {
  const s = istParts(instant);
  return `${istDateKey(instant)} ${pad2(s.getUTCHours())}:${pad2(s.getUTCMinutes())}`;
}

/** Protects spreadsheet users: text starting with a formula character is prefixed so Excel will not run it. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Builds a CSV document from row objects. The header order follows `columns`. */
export function toCsv(columns: { key: string; header: string }[], rows: Record<string, unknown>[]): string {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(","));
  return [head, ...body].join("\r\n");
}

// ---------------------------------------------------------------- DTOs shared with the client

export interface TransactionRow {
  id: string;
  /** ISO timestamp: when the payment was captured, or when it was started if it never was. */
  date: string;
  companyId: string;
  companyName: string;
  companyCode: string | null;
  planName: string | null;
  months: number;
  provider: string;
  amount: number;
  refundedAmount: number;
  status: string;
  statusKey: StatusKey;
  statusLabel: string;
  method: string | null;
  methodLabel: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
}

export interface KpiSummary {
  today: { amount: number; count: number };
  month: { amount: number; count: number };
  lifetime: { gross: number; refunded: number; net: number; count: number };
  open: {
    days: number;
    count: number;
    amount: number;
    failed: { count: number; amount: number };
    pending: { count: number; amount: number };
  };
}

export interface TrendPoint {
  key: string;
  label: string;
  amount: number;
  count: number;
}

export interface PaymentEvent {
  event: string;
  source: string;
  at: string;
}

export interface PaymentDetail {
  id: string;
  date: string;
  createdAt: string;
  paidAt: string | null;
  provider: string;
  status: string;
  statusKey: StatusKey;
  statusLabel: string;
  amount: number;
  refundedAmount: number;
  netAmount: number;
  months: number;
  discountPercent: number;
  /** Plan price for the whole cycle before discount, or null when the plan was removed. */
  listTotal: number | null;
  discountAmount: number | null;
  planName: string | null;
  planSeats: number | null;
  method: string | null;
  methodLabel: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  company: { id: string; name: string; code: string | null; email: string | null };
  initiatedBy: { name: string; email: string } | null;
  gateway: GatewayDetails;
  events: PaymentEvent[];
}
