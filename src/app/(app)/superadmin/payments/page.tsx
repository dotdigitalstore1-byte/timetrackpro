"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, downloadBlob } from "@/lib/client";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { cn, formatMoney, formatNumber } from "@/lib/utils";
import type {
  KpiSummary,
  PaymentDetail,
  RangeKey,
  StatusKey,
  TransactionRow,
  TrendPoint,
} from "@/lib/payments-report";

interface ListResponse {
  summary: KpiSummary;
  trend: { daily: TrendPoint[]; monthly: TrendPoint[] };
  plans: { id: string; name: string }[];
  transactions: TransactionRow[];
  total: number;
  hasMore: boolean;
  page: number;
  generatedAt: string;
}

type StatusFilter = StatusKey | "all";
type Tone = "emerald" | "indigo" | "sky" | "rose" | "slate";

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom" },
];

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "captured", label: "Captured" },
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Pending" },
  { value: "refunded", label: "Refunded" },
];

const STATUS_TONE: Record<StatusKey, "green" | "red" | "amber" | "sky"> = {
  captured: "green",
  failed: "red",
  pending: "amber",
  refunded: "sky",
};

const TONE: Record<Tone, { bg: string; text: string }> = {
  emerald: { bg: "bg-emerald-50", text: "text-emerald-700" },
  indigo: { bg: "bg-indigo-50", text: "text-indigo-700" },
  sky: { bg: "bg-sky-50", text: "text-sky-700" },
  rose: { bg: "bg-rose-50", text: "text-rose-700" },
  slate: { bg: "bg-slate-100", text: "text-slate-600" },
};

const EVENT_LABELS: Record<string, string> = {
  "payment.captured": "Payment captured",
  "payment.failed": "Payment failed",
  "refund.processed": "Refund processed",
  PAYMENT_SUCCESS_WEBHOOK: "Payment succeeded (webhook)",
};

const GATEWAY_NAMES: Record<string, string> = { razorpay: "Razorpay", cashfree: "Cashfree" };

const money = (n: number, digits = 2) => formatMoney(n, digits);
const count = (n: number, word: string) => `${formatNumber(n, 0)} ${word}${n === 1 ? "" : "s"}`;

function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** The query string for the filters. Shared by the list, Load more and the export so they always agree. */
function buildQuery(f: { range: RangeKey; status: StatusFilter; planId: string; q: string; customFrom: string; customTo: string }): string {
  const p = new URLSearchParams({ range: f.range, status: f.status });
  if (f.range === "custom") {
    p.set("from", f.customFrom);
    p.set("to", f.customTo);
  }
  if (f.planId) p.set("planId", f.planId);
  if (f.q) p.set("q", f.q);
  return p.toString();
}

export default function SuperAdminPaymentsPage() {
  const [range, setRange] = useState<RangeKey>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [planId, setPlanId] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [trendMode, setTrendMode] = useState<"daily" | "monthly">("daily");

  const [data, setData] = useState<ListResponse | null>(null);
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PaymentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const listSeq = useRef(0);
  const detailSeq = useRef(0);

  // Search waits for a pause in typing so each keystroke does not fire a request.
  useEffect(() => {
    const t = window.setTimeout(() => setQ(searchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const customReady = range !== "custom" || (!!customFrom && !!customTo);
  const query = buildQuery({ range, status, planId, q, customFrom, customTo });

  // Reload the first page whenever the filters change. Stale responses are ignored.
  useEffect(() => {
    if (!customReady) return;
    const seq = ++listSeq.current;
    setLoading(true);
    setError("");
    api<ListResponse>(`/api/superadmin/payments?${query}&page=0`)
      .then((res) => {
        if (seq !== listSeq.current) return;
        setData(res);
        setRows(res.transactions);
        setPage(0);
      })
      .catch((e) => {
        if (seq !== listSeq.current) return;
        setError(errorText(e, "Could not load payments."));
      })
      .finally(() => {
        if (seq === listSeq.current) setLoading(false);
      });
  }, [query, customReady, reloadKey]);

  const loadMore = async () => {
    const next = page + 1;
    const seq = listSeq.current;
    setLoadingMore(true);
    try {
      const res = await api<ListResponse>(`/api/superadmin/payments?${query}&page=${next}`);
      if (seq !== listSeq.current) return;
      setRows((prev) => [...prev, ...res.transactions]);
      setData((prev) => (prev ? { ...prev, hasMore: res.hasMore, total: res.total } : res));
      setPage(next);
    } catch (e) {
      setError(errorText(e, "Could not load more payments."));
    } finally {
      setLoadingMore(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    setExportError("");
    try {
      const res = await fetch(`/api/superadmin/payments/export?${query}`, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "The export could not be created.");
      }
      const blob = await res.blob();
      downloadBlob(blob, `razorpay-payments-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
    } catch (e) {
      setExportError(errorText(e, "The export could not be created."));
    } finally {
      setExporting(false);
    }
  };

  const openDetail = useCallback((id: string) => {
    const seq = ++detailSeq.current;
    setOpenId(id);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    api<PaymentDetail>(`/api/superadmin/payments/${id}`)
      .then((d) => {
        if (seq === detailSeq.current) setDetail(d);
      })
      .catch((e) => {
        if (seq === detailSeq.current) setDetailError(errorText(e, "Could not load this payment."));
      })
      .finally(() => {
        if (seq === detailSeq.current) setDetailLoading(false);
      });
  }, []);

  const closeDetail = useCallback(() => {
    detailSeq.current++;
    setOpenId(null);
  }, []);

  const resetFilters = () => {
    setRange("month");
    setStatus("all");
    setPlanId("");
    setSearchInput("");
    setQ("");
    setCustomFrom("");
    setCustomTo("");
  };

  const activeFilters = [range !== "month", status !== "all", planId !== "", q !== ""].filter(Boolean).length;
  const summary = data?.summary;
  const monthName = data
    ? new Date(data.generatedAt).toLocaleDateString("en-IN", { month: "long", timeZone: "Asia/Kolkata" })
    : "";

  return (
    <div>
      <PageHeader
        title="Payments"
        subtitle="Every Razorpay payment across all companies. Amounts in ₹, dates in IST."
        action={
          <Button size="sm" variant="secondary" loading={exporting} disabled={!customReady || !data} onClick={exportCsv}>
            Export CSV
          </Button>
        }
      />

      {exportError && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{exportError}</p>}

      {loading && !data ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : !data || !summary ? (
        <Card>
          <p className="text-center text-sm font-medium text-rose-600">{error || "Payments are not available right now."}</p>
          <div className="mt-3 flex justify-center">
            <Button size="sm" variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
              Try again
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Headline numbers. They stay put when the table filters change. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              tone="emerald"
              label="Today's revenue"
              value={money(summary.today.amount, 0)}
              hint={`${count(summary.today.count, "payment")} captured today`}
              icon={<IconRupee />}
            />
            <KpiCard
              tone="indigo"
              label={`${monthName || "This month"} revenue`}
              value={money(summary.month.amount, 0)}
              hint={`${count(summary.month.count, "payment")} this month`}
              icon={<IconCalendar />}
            />
            <KpiCard
              tone="sky"
              label="Total lifetime revenue"
              value={money(summary.lifetime.net, 0)}
              hint={`Net of refunds · gross ${money(summary.lifetime.gross, 0)} · refunded ${money(summary.lifetime.refunded, 0)}`}
              icon={<IconStack />}
            />
            <KpiCard
              tone={summary.open.count > 0 ? "rose" : "slate"}
              label="Failed / pending"
              value={money(summary.open.amount, 0)}
              hint={`${count(summary.open.count, "payment")} in the last ${summary.open.days} days: ${formatNumber(summary.open.failed.count, 0)} failed, ${formatNumber(summary.open.pending.count, 0)} pending`}
              icon={<IconAlert />}
            />
          </div>

          <Card className="p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-900">Revenue trend</h3>
                <p className="text-xs text-slate-500">Collected per day for the last 30 days, or per month for the last 12.</p>
              </div>
              <Segmented
                value={trendMode}
                onChange={setTrendMode}
                options={[
                  { value: "daily", label: "Daily" },
                  { value: "monthly", label: "Monthly" },
                ]}
              />
            </div>
            <RevenueBars key={trendMode} points={trendMode === "daily" ? data.trend.daily : data.trend.monthly} />
          </Card>

          {/* Filters: thumb-sized controls that stack on phones. */}
          <Card className="space-y-3 p-3 sm:p-4">
            <Input value={searchInput} onChange={setSearchInput} placeholder="Search company, Razorpay payment ID or order ID" />

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {RANGE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setRange(o.value)}
                  aria-pressed={range === o.value}
                  className={cn(
                    "min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors",
                    range === o.value ? "bg-indigo-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>

            {range === "custom" && (
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" label="From" value={customFrom} max={customTo || undefined} onChange={setCustomFrom} />
                <Input type="date" label="To" value={customTo} min={customFrom || undefined} onChange={setCustomTo} />
              </div>
            )}
            {!customReady && <p className="text-xs font-medium text-amber-700">Choose both dates to see this range.</p>}

            <div className="flex flex-wrap gap-2" role="group" aria-label="Payment status">
              {STATUS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setStatus(o.value)}
                  aria-pressed={status === o.value}
                  className={cn(
                    "min-h-9 rounded-full px-3.5 text-xs font-semibold ring-1 transition-colors",
                    status === o.value ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <div className="grid gap-2 sm:grid-cols-2 sm:items-end">
              <Select
                label="Plan"
                value={planId}
                onChange={setPlanId}
                options={[{ value: "", label: "All plans" }, ...data.plans.map((p) => ({ value: p.id, label: p.name }))]}
              />
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <p className="text-xs font-medium text-slate-500">
                  {activeFilters > 0 ? `${activeFilters} filter${activeFilters > 1 ? "s" : ""} on` : "No filters"}
                </p>
                {activeFilters > 0 && (
                  <button type="button" onClick={resetFilters} className="min-h-10 rounded-lg px-3 text-xs font-semibold text-indigo-600 hover:bg-indigo-50">
                    Clear filters
                  </button>
                )}
              </div>
            </div>
          </Card>

          <p className="px-1 text-xs font-medium text-slate-500">
            Showing {formatNumber(rows.length, 0)} of {formatNumber(data.total, 0)} {data.total === 1 ? "payment" : "payments"}
          </p>

          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}

          {rows.length === 0 && !loading ? (
            <div className="space-y-3">
              <EmptyState message="No payments match these filters." />
              <div className="flex justify-center">
                <Button size="sm" variant="secondary" onClick={resetFilters}>Clear filters</Button>
              </div>
            </div>
          ) : (
            <div className={cn("transition-opacity", loading && "opacity-50")} aria-busy={loading}>
              {/* Desktop: a proper table. */}
              <Card className="hidden overflow-hidden p-0 md:block">
                <table className="w-full table-fixed text-left text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="w-[15%] px-4 py-3 font-semibold">Date &amp; time</th>
                      <th className="w-[20%] px-4 py-3 font-semibold">Company</th>
                      <th className="w-[15%] px-4 py-3 font-semibold">Plan / cycle</th>
                      <th className="w-[11%] px-4 py-3 text-right font-semibold">Amount</th>
                      <th className="w-[11%] px-4 py-3 font-semibold">Status</th>
                      <th className="w-[10%] px-4 py-3 font-semibold">Method</th>
                      <th className="w-[18%] px-4 py-3 font-semibold">Razorpay ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {rows.map((t) => (
                      <tr
                        key={t.id}
                        tabIndex={0}
                        onClick={() => openDetail(t.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openDetail(t.id);
                          }
                        }}
                        className="cursor-pointer transition-colors hover:bg-indigo-50/50 focus-visible:bg-indigo-50 focus-visible:outline-none"
                      >
                        <td className="px-4 py-3 text-slate-600">{dateTime(t.date)}</td>
                        <td className="px-4 py-3">
                          <p className="truncate font-bold text-slate-800">{t.companyName}</p>
                          <p className="truncate font-mono text-[11px] font-semibold tracking-wider text-indigo-600">{t.companyCode ?? "no code"}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <p className="truncate font-semibold text-slate-700">{t.planName ?? "Plan removed"}</p>
                          <p className="text-xs text-slate-400">{count(t.months, "month")}</p>
                        </td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-900">{money(t.amount)}</td>
                        <td className="px-4 py-3">
                          <Badge tone={STATUS_TONE[t.statusKey]}>{t.statusLabel}</Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{t.methodLabel}</td>
                        <td className="px-4 py-3">
                          <p className="truncate font-mono text-xs text-slate-700">{t.providerPaymentId ?? "—"}</p>
                          <p className="truncate font-mono text-[11px] text-slate-400">{t.providerOrderId ?? ""}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              {/* Mobile: stacked cards with status badges. Each card is one large tap target. */}
              <ul className="space-y-3 md:hidden">
                {rows.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => openDetail(t.id)}
                      className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition active:scale-[0.99] active:bg-slate-50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-bold text-slate-800">{t.companyName}</p>
                          <p className="text-xs text-slate-400">{dateTime(t.date)}</p>
                        </div>
                        <p className="shrink-0 text-right text-lg font-bold tabular-nums text-slate-900">{money(t.amount, 0)}</p>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <Badge tone={STATUS_TONE[t.statusKey]}>{t.statusLabel}</Badge>
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">{t.planName ?? "Plan removed"}</span>
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">{count(t.months, "month")}</span>
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">{t.methodLabel}</span>
                      </div>
                      <p className="mt-3 truncate font-mono text-[11px] text-slate-500">{t.providerPaymentId ?? t.providerOrderId ?? "No gateway ID"}</p>
                    </button>
                  </li>
                ))}
              </ul>

              {data.hasMore && (
                <div className="mt-4 flex justify-center">
                  <Button variant="secondary" className="w-full sm:w-auto" loading={loadingMore} onClick={loadMore}>
                    Load more
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <PaymentDrawer
        open={openId !== null}
        loading={detailLoading}
        error={detailError}
        detail={detail}
        onRetry={() => openId && openDetail(openId)}
        onClose={closeDetail}
      />
    </div>
  );
}

// ------------------------------------------------------------------ KPI cards

function KpiCard({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint: ReactNode; tone: Tone; icon: ReactNode }) {
  return (
    <Card className="p-4 transition-transform hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold leading-snug text-slate-500">{label}</p>
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", TONE[tone].bg, TONE[tone].text)}>{icon}</span>
      </div>
      <p className="mt-2 truncate text-xl font-bold tabular-nums text-slate-900 sm:text-2xl">{value}</p>
      <p className="mt-1 text-[11px] leading-snug text-slate-500">{hint}</p>
    </Card>
  );
}

// ------------------------------------------------------------------ revenue chart

/** Bars for each day or month. Tap a bar to read it. Bars grow in on load. */
function RevenueBars({ points }: { points: TrendPoint[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [grown, setGrown] = useState(false);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setGrown(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  if (points.length === 0) return null;
  const max = Math.max(1, ...points.map((p) => p.amount));
  const total = points.reduce((s, p) => s + p.amount, 0);
  const selectedIndex = active ?? points.length - 1;
  const selected = points[selectedIndex];
  const ticks = [points[0], points[Math.floor((points.length - 1) / 2)], points[points.length - 1]];

  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{selected.label}</p>
          <p className="text-lg font-bold tabular-nums text-slate-900">
            {money(selected.amount, 0)}
            <span className="ml-2 text-xs font-medium text-slate-500">{count(selected.count, "payment")}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-400">Total in this view</p>
          <p className="text-sm font-bold tabular-nums text-slate-700">{money(total, 0)}</p>
        </div>
      </div>

      <div className="flex h-36 items-end gap-[3px] sm:h-44 sm:gap-1.5" role="group" aria-label="Revenue bars">
        {points.map((p, i) => {
          const isSelected = i === selectedIndex;
          const pct = (p.amount / max) * 100;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`${p.label}: ${money(p.amount, 0)}, ${count(p.count, "payment")}`}
              aria-pressed={isSelected}
              className="group flex h-full min-w-0 flex-1 flex-col justify-end rounded-md focus-visible:outline-2 focus-visible:outline-indigo-500"
            >
              <span
                className={cn(
                  "w-full rounded-t-md transition-[height,background-color] duration-700 ease-out",
                  isSelected ? "bg-indigo-600" : p.amount > 0 ? "bg-indigo-300 group-hover:bg-indigo-400" : "bg-slate-200"
                )}
                style={{ height: grown ? `${p.amount > 0 ? Math.max(pct, 4) : 2}%` : "0%" }}
              />
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex justify-between text-[10px] font-medium text-slate-400">
        <span>{ticks[0].label}</span>
        <span>{ticks[1].label}</span>
        <span>{ticks[2].label}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ status

function StatusBadge({ statusKey, label }: { statusKey: StatusKey; label: string }) {
  return <Badge tone={STATUS_TONE[statusKey]}>{label}</Badge>;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-xl bg-slate-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "min-h-9 rounded-lg px-3 text-xs font-bold transition-colors",
            value === o.value ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-800"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ detail drawer

/** A right-hand panel on desktop and a bottom sheet on phones. Closes on Escape or a tap outside. */
function PaymentDrawer({
  open,
  loading,
  error,
  detail,
  onRetry,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  error: string;
  detail: PaymentDetail | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => setShown(true));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(id);
      setShown(false);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm transition-opacity duration-300",
        shown ? "opacity-100" : "opacity-0"
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Payment details"
        className={cn(
          "fixed inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-3xl bg-white shadow-2xl transition-transform duration-300 ease-out",
          "sm:inset-y-0 sm:bottom-auto sm:left-auto sm:right-0 sm:max-h-none sm:w-[460px] sm:rounded-none",
          shown ? "translate-y-0 sm:translate-x-0" : "translate-y-full sm:translate-y-0 sm:translate-x-full"
        )}
      >
        <div className="flex justify-center pt-2 sm:hidden" aria-hidden="true">
          <span className="h-1.5 w-12 rounded-full bg-slate-300" />
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-bold text-slate-900">Payment details</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          {loading && !detail ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : error && !detail ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-rose-600">{error}</p>
              <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>
                Try again
              </Button>
            </div>
          ) : detail ? (
            <PaymentDetailBody detail={detail} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

const GATEWAY_ROWS: { key: string; label: string; format?: (v: string | number | boolean) => string }[] = [
  { key: "bank", label: "Bank" },
  { key: "wallet", label: "Wallet" },
  { key: "vpa", label: "UPI ID" },
  { key: "cardNetwork", label: "Card network" },
  { key: "cardType", label: "Card type" },
  { key: "cardIssuer", label: "Card issuer" },
  { key: "international", label: "International", format: (v) => (v ? "Yes" : "No") },
  { key: "refundStatus", label: "Refund status" },
];

/** Error fields are only shown in the failure box, never in the gateway section (a paid retry may carry old errors). */
const ERROR_KEYS = ["errorCode", "errorDescription", "errorReason", "errorSource", "errorStep"];
const ERROR_LABELS: Record<string, string> = {
  errorCode: "Error code",
  errorDescription: "Description",
  errorReason: "Reason",
  errorSource: "Raised by",
  errorStep: "Step",
};

function PaymentDetailBody({ detail: d }: { detail: PaymentDetail }) {
  const g = d.gateway;
  const net = d.netAmount;
  const hasCard = typeof g.cardLast4 === "string";
  const cardText = hasCard
    ? [g.cardNetwork, g.cardType, `•••• ${g.cardLast4}`].filter(Boolean).join(" · ")
    : null;
  const errorRows = ERROR_KEYS.filter((k) => g[k] !== undefined);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-bold text-slate-900">{d.company.name}</p>
            <p className="font-mono text-[11px] font-semibold tracking-wider text-indigo-600">{d.company.code ?? "no code"}</p>
          </div>
          <StatusBadge statusKey={d.statusKey} label={d.statusLabel} />
        </div>
        <p className="mt-3 text-3xl font-bold tabular-nums tracking-tight text-slate-900">{money(d.amount)}</p>
        <p className="mt-1 text-xs text-slate-500">
          {dateTime(d.paidAt ?? d.createdAt)} · {d.methodLabel}
        </p>
        {d.refundedAmount > 0 && (
          <p className="mt-3 rounded-lg bg-sky-100/70 px-3 py-2 text-xs font-semibold text-sky-800">
            Refunded {money(d.refundedAmount)} · net kept {money(net)}
          </p>
        )}
      </div>

      {d.statusKey === "failed" && (
        <section className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4">
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-rose-600">What went wrong</h4>
          {errorRows.length === 0 ? (
            <p className="text-sm text-rose-800">The gateway did not give a reason for this failure.</p>
          ) : (
            <dl className="space-y-1 text-sm">
              {errorRows.map((k) => (
                <Row key={k} label={ERROR_LABELS[k]}>
                  {String(g[k])}
                </Row>
              ))}
            </dl>
          )}
        </section>
      )}

      <Section title="Payment breakdown">
        <Row label="Plan">{d.planName ?? "Plan removed"}</Row>
        <Row label="Billing cycle">{count(d.months, "month")}</Row>
        {d.planSeats !== null && <Row label="Seats">Up to {formatNumber(d.planSeats, 0)} employees</Row>}
        {d.listTotal !== null && <Row label="List price">{money(d.listTotal)}</Row>}
        {d.discountAmount !== null && d.discountAmount > 0 && (
          <Row label={d.discountPercent > 0 ? `Discount (${d.discountPercent}%)` : "Discount"}>
            <span className="font-semibold text-emerald-700">− {money(d.discountAmount)}</span>
          </Row>
        )}
        <Row label="Charged" strong>
          {money(d.amount)}
        </Row>
        {d.refundedAmount > 0 && <Row label="Refunded">− {money(d.refundedAmount)}</Row>}
        <Row label="Net" strong>
          {money(net)}
        </Row>
      </Section>

      <Section title="Gateway">
        <Row label="Gateway">{GATEWAY_NAMES[d.provider] ?? d.provider}</Row>
        <Row label="Method">{d.methodLabel}</Row>
        {d.providerPaymentId && (
          <Row label="Payment ID">
            <IdValue value={d.providerPaymentId} label="payment ID" />
          </Row>
        )}
        {d.providerOrderId && (
          <Row label="Order ID">
            <IdValue value={d.providerOrderId} label="order ID" />
          </Row>
        )}
        {cardText && <Row label="Card">{cardText}</Row>}
        {GATEWAY_ROWS.filter((r) => g[r.key] !== undefined && g[r.key] !== "").map((r) => (
          <Row key={r.key} label={r.label}>
            {r.format ? r.format(g[r.key]) : String(g[r.key])}
          </Row>
        ))}
        {g.fee !== undefined && <Row label="Gateway fee">{money(Number(g.fee))}</Row>}
        {g.tax !== undefined && <Row label="Tax on fee">{money(Number(g.tax))}</Row>}
        {typeof g.gatewayCreatedAt === "string" && <Row label="Gateway time">{dateTime(g.gatewayCreatedAt)}</Row>}
      </Section>

      <Section title="Webhook and gateway events">
        {d.events.length === 0 ? (
          <p className="text-sm text-slate-500">No gateway events recorded for this payment yet.</p>
        ) : (
          <ol className="relative space-y-3 border-l-2 border-slate-100 pl-4">
            {d.events.map((e, i) => (
              <li key={`${e.event}-${e.at}-${i}`} className="relative">
                <span className="absolute -left-[22px] top-1.5 h-2.5 w-2.5 rounded-full bg-indigo-500 ring-4 ring-white" />
                <p className="text-sm font-semibold text-slate-800">{EVENT_LABELS[e.event] ?? e.event}</p>
                <p className="text-xs text-slate-500">
                  {e.source === "webhook" ? "Webhook" : "Checkout confirmation"} · {dateTime(e.at)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Records">
        <Row label="Started">{dateTime(d.createdAt)}</Row>
        <Row label="Captured">{d.paidAt ? dateTime(d.paidAt) : "Not captured"}</Row>
        <Row label="Company admin">{d.company.email ?? "—"}</Row>
        <Row label="Started by">{d.initiatedBy ? `${d.initiatedBy.name} · ${d.initiatedBy.email}` : "—"}</Row>
      </Section>

      <details className="rounded-2xl border border-slate-200 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-600">Raw gateway data</summary>
        <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
          {JSON.stringify({ gateway: d.gateway, events: d.events }, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 p-4">
      <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">{title}</h4>
      <dl className="divide-y divide-slate-100">{children}</dl>
    </section>
  );
}

function Row({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className={cn("min-w-0 text-right text-slate-800", strong && "font-bold text-slate-900")}>{children}</dd>
    </div>
  );
}

function IdValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <span className="truncate font-mono text-xs">{value}</span>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            // The browser blocked clipboard access. The value is still visible to copy by hand.
          }
        }}
        className="shrink-0 rounded-md px-2 py-1 text-[11px] font-bold text-indigo-600 hover:bg-indigo-50"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

// ------------------------------------------------------------------ icons

const svg = (d: string) => (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d={d} />
  </svg>
);
const IconRupee = () => <span className="text-sm font-bold leading-none">₹</span>;
const IconCalendar = () => svg("M8 7V3m8 4V3M3 9h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z");
const IconStack = () => svg("M4 7l8-4 8 4-8 4-8-4zm0 5l8 4 8-4m-16 5l8 4 8-4");
const IconAlert = () => svg("M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z");
