"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, PageHeader, Spinner, Textarea } from "@/components/ui";
import { formatMoney } from "@/lib/utils";
import { AUTO_COMPLETE_AFTER_HOURS, DEFAULT_AUTO_SATISFACTION } from "@/lib/onboarding-core";

interface Tier {
  id: string;
  maxEmployees: number | null;
  pricePerEmployee: number;
}

interface RequestRow {
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

interface Quote {
  baseFee: number;
  employeeCount: number;
  employeeRate: number;
  employeeFee: number;
  total: number;
  tierLabel: string;
}

interface PageData {
  prices: { baseFee: number; tiers: Tier[] };
  requests: RequestRow[];
  paymentsEnabled: boolean;
  contactDefaults: { email: string; whatsapp: string };
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load the payment window. Check your connection and try again."));
    document.body.appendChild(s);
  });
}

const STATUS: Record<string, { label: string; tone: "amber" | "indigo" | "sky" | "green" | "slate" }> = {
  open: { label: "Waiting for a specialist", tone: "amber" },
  claimed: { label: "Accepted", tone: "indigo" },
  awaiting_rating: { label: "Work done: please rate", tone: "sky" },
  completed: { label: "Completed", tone: "green" },
};

function describeServices(r: Pick<RequestRow, "includeOnboarding" | "includeEmployees" | "employeeCount">) {
  const parts: string[] = [];
  if (r.includeOnboarding) parts.push("Onboarding");
  if (r.includeEmployees) parts.push(`${r.employeeCount} employee${r.employeeCount === 1 ? "" : "s"} added`);
  return parts.join(" + ");
}

export default function ExpertOnboardingPage() {
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [withOnboarding, setWithOnboarding] = useState(true);
  const [withEmployees, setWithEmployees] = useState(false);
  const [employeeCount, setEmployeeCount] = useState("5");
  const [contactName, setContactName] = useState("");
  const [setupRequirements, setSetupRequirements] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [call, setCall] = useState("");
  const [callSame, setCallSame] = useState(true);

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [paying, setPaying] = useState(false);
  const [ratingFor, setRatingFor] = useState<string | null>(null);
  const [ratingValue, setRatingValue] = useState("80");
  const [ratingBusy, setRatingBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await api<PageData>("/api/onboarding");
      setData(d);
      setEmail((cur) => cur || d.contactDefaults.email);
      setWhatsapp((cur) => cur || d.contactDefaults.whatsapp);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Expert Onboarding");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Live preview: the server prices the choice from the Superadmin configuration.
  useEffect(() => {
    if (!withOnboarding && !withEmployees) {
      setQuote(null);
      setQuoteError("Choose at least one service.");
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api<{ quote: Quote }>("/api/onboarding/quote", {
          method: "POST",
          body: JSON.stringify({ includeOnboarding: withOnboarding, includeEmployees: withEmployees, employeeCount: Number(employeeCount) || 0 }),
        });
        setQuote(res.quote);
        setQuoteError("");
      } catch (e) {
        setQuote(null);
        setQuoteError(e instanceof Error ? e.message : "Could not price this request");
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [withOnboarding, withEmployees, employeeCount]);

  const payable = !!quote && !quoteError && !!data?.paymentsEnabled;
  const slabSummary = useMemo(() => {
    if (!data) return [];
    return [...data.prices.tiers].sort((a, b) => (a.maxEmployees ?? Infinity) - (b.maxEmployees ?? Infinity));
  }, [data]);

  const pay = async () => {
    setError("");
    setNotice("");
    setPaying(true);
    try {
      const order = await api<{
        requestId: string;
        orderId: string;
        razorpay: { keyId: string; amountMinor: number; currency: string; name: string; description: string; prefill: Record<string, string> };
      }>("/api/onboarding/checkout", {
        method: "POST",
        body: JSON.stringify({
          includeOnboarding: withOnboarding,
          includeEmployees: withEmployees,
          employeeCount: Number(employeeCount) || 0,
          contactName,
          setupRequirements,
          whatsapp,
          email,
          call,
          callSameAsWhatsapp: callSame,
        }),
      });
      await loadScript("https://checkout.razorpay.com/v1/checkout.js");
      const RZ = window.Razorpay!;
      const rz = new RZ({
        key: order.razorpay.keyId,
        amount: order.razorpay.amountMinor,
        currency: order.razorpay.currency,
        name: order.razorpay.name,
        description: order.razorpay.description,
        order_id: order.orderId,
        prefill: order.razorpay.prefill,
        theme: { color: "#4f46e5" },
        handler: async (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            const res = await api<{ status: string }>("/api/onboarding/confirm", {
              method: "POST",
              body: JSON.stringify({
                orderId: r.razorpay_order_id,
                paymentId: r.razorpay_payment_id,
                signature: r.razorpay_signature,
              }),
            });
            setNotice(
              res.status === "pending"
                ? "Payment received and being confirmed. Your request will appear shortly."
                : "Payment confirmed. Your request is with our specialists now."
            );
            await load();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not confirm the payment");
          } finally {
            setPaying(false);
          }
        },
        modal: { ondismiss: () => setPaying(false) },
      });
      rz.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the payment");
      setPaying(false);
    }
  };

  const submitRating = async (requestId: string) => {
    setRatingBusy(true);
    setError("");
    try {
      await api("/api/onboarding/rate", { method: "POST", body: JSON.stringify({ requestId, satisfaction: Number(ratingValue) }) });
      setRatingFor(null);
      setNotice("Thank you for rating your onboarding.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your rating");
    } finally {
      setRatingBusy(false);
    }
  };

  const inputsInvalid =
    !contactName.trim() || !setupRequirements.trim() || !whatsapp.trim() || !email.trim() || (!callSame && !call.trim());

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-8">
      <PageHeader
        title="Expert Onboarding"
        subtitle="Let our specialists set up your account, payroll and attendance rules, and add your team."
      />

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {notice && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{notice}</p>}

      <Card className="space-y-5">
        <div>
          <h2 className="text-base font-bold text-slate-900">1. What do you need?</h2>
          <p className="mt-1 text-sm text-slate-500">Choose one or both.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <ServiceToggle
              active={withOnboarding}
              onClick={() => setWithOnboarding((v) => !v)}
              title="Onboarding only"
              description="Account setup, rules and payroll configuration."
              price={data ? `${formatMoney(data.prices.baseFee, 0)} one-time` : "…"}
            />
            <ServiceToggle
              active={withEmployees}
              onClick={() => setWithEmployees((v) => !v)}
              title="Employee addition"
              description="We add employee profiles and their login credentials."
              price={slabSummary.length ? slabSummary.map((t) => `${formatMoney(t.pricePerEmployee, 0)}/${t.maxEmployees === null ? "above" : `≤${t.maxEmployees}`}`).join(" · ") : "…"}
            />
          </div>

          {withEmployees && (
            <div className="mt-4 max-w-xs">
              <Input label="How many employees to add?" type="number" min="1" value={employeeCount} onChange={setEmployeeCount} />
              <p className="mt-1 text-xs text-slate-500">
                Rate for the slab your total falls in, applied to every employee.
              </p>
            </div>
          )}

          <div className="mt-4 rounded-xl bg-slate-50 p-4">
            {quote && !quoteError ? (
              <dl className="space-y-1 text-sm">
                {withOnboarding && (
                  <div className="flex justify-between"><dt className="text-slate-600">Onboarding</dt><dd className="font-semibold">{formatMoney(quote.baseFee, 2)}</dd></div>
                )}
                {withEmployees && (
                  <div className="flex justify-between">
                    <dt className="text-slate-600">{quote.employeeCount} employees ({quote.tierLabel}, {formatMoney(quote.employeeRate, 0)} each)</dt>
                    <dd className="font-semibold">{formatMoney(quote.employeeFee, 2)}</dd>
                  </div>
                )}
                <div className="flex justify-between border-t border-slate-200 pt-2 text-base">
                  <dt className="font-bold text-slate-900">Total</dt>
                  <dd className="font-bold text-slate-900">{formatMoney(quote.total, 2)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-slate-500">{quoteError || "Calculating…"}</p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-base font-bold text-slate-900">2. How can our specialists reach you?</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Contact person's name" value={contactName} onChange={setContactName} placeholder="Full name of the person to contact" required />
            <Input label="WhatsApp number" type="tel" value={whatsapp} onChange={setWhatsapp} placeholder="+91 98xxxxxx" required />
            <Input label="Email ID" type="email" value={email} onChange={setEmail} placeholder="you@company.com" required />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={callSame} onChange={(e) => setCallSame(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
            Same as WhatsApp number
          </label>
          {!callSame && <Input label="Calling number" type="tel" value={call} onChange={setCall} placeholder="+91 98xxxxxx" required />}
          <Textarea
            label="What exactly needs to be set up?"
            value={setupRequirements}
            onChange={setSetupRequirements}
            rows={4}
            placeholder="For example: 3 departments, 2 shifts, leave policy, biometric devices, employees to add (list names or roles)"
          />
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            {data && !data.paymentsEnabled
              ? "Online payment is not set up yet, so requests cannot be placed. Please contact support."
              : "Your request reaches a specialist as soon as payment is confirmed."}
          </p>
          <Button onClick={() => void pay()} disabled={!payable || inputsInvalid || paying} loading={paying} className="w-full sm:w-auto">
            {quote && !quoteError ? `Pay ${formatMoney(quote.total, 2)}` : "Pay"}
          </Button>
        </div>
      </Card>

      <section className="space-y-3">
        <h2 className="text-base font-bold text-slate-900">Your requests</h2>
        {loading && !data && (
          <div className="flex justify-center py-10"><Spinner /></div>
        )}
        {data && data.requests.length === 0 && <EmptyState message="No Expert Onboarding requests yet." />}
        {data?.requests.map((r) => {
          const s = STATUS[r.status] ?? { label: r.status, tone: "slate" as const };
          return (
            <Card key={r.id} className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{describeServices(r)}</p>
                  <p className="text-xs text-slate-500">
                    Paid {formatMoney(r.total, 2)}
                    {r.paidAt ? ` · ${new Date(r.paidAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}
                  </p>
                </div>
                <Badge tone={s.tone}>{s.label}</Badge>
              </div>

              {r.specialistName && (
                <p className="text-sm text-slate-600">
                  Specialist: <span className="font-semibold text-slate-800">{r.specialistName}</span>
                </p>
              )}

              {r.status === "claimed" && (
                <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
                  {r.specialistName ?? "Your specialist"} will contact you and complete the onboarding setup within 48 hours.
                </p>
              )}

              {r.ratingReminder && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                  Reminder: please rate your onboarding. If you do not rate within {AUTO_COMPLETE_AFTER_HOURS} hours, it will be recorded as {DEFAULT_AUTO_SATISFACTION}% and closed automatically.
                </p>
              )}

              {r.canRate && ratingFor !== r.id && (
                <Button variant="secondary" onClick={() => { setRatingFor(r.id); setRatingValue("80"); }}>
                  Rate your satisfaction
                </Button>
              )}

              {ratingFor === r.id && (
                <div className="space-y-3 rounded-xl bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-800">How satisfied are you? <span className="text-indigo-700">{ratingValue}%</span></p>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step={1}
                    value={ratingValue}
                    onChange={(e) => setRatingValue(e.target.value)}
                    className="w-full accent-indigo-600"
                    aria-label="Satisfaction percentage"
                  />
                  <div className="flex gap-2">
                    <Button onClick={() => void submitRating(r.id)} loading={ratingBusy}>Submit rating</Button>
                    <Button variant="ghost" onClick={() => setRatingFor(null)}>Cancel</Button>
                  </div>
                </div>
              )}

              {r.satisfaction !== null && r.status === "completed" && (
                <p className="text-xs text-slate-500">
                  Satisfaction {r.satisfaction}%{r.ratingSource === "auto" ? " (recorded automatically after 48 hours without a rating)" : ""}
                </p>
              )}
            </Card>
          );
        })}
      </section>
    </div>
  );
}

function ServiceToggle({
  active,
  onClick,
  title,
  description,
  price,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  description: string;
  price: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-[44px] rounded-2xl border p-4 text-left transition ${
        active ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200" : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold text-slate-900">{title}</p>
        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${active ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300"}`} aria-hidden="true">
          {active && "✓"}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
      <p className="mt-2 text-xs font-semibold text-indigo-700">{price}</p>
    </button>
  );
}
