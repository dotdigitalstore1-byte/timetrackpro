"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, clearMe } from "@/lib/client";
import { Button, Card, Spinner } from "@/components/ui";
import PlanPicker, { type CycleView, type PlanView } from "@/components/PlanPicker";

interface BillingData {
  company: { name: string; subscriptionPlan: string };
  role: string;
  access: {
    state: "trial" | "active" | "legacy" | "expired";
    phase: string;
    locked: boolean;
    staffLocked: boolean;
    daysLeft: number | null;
    endedAs: "trial" | "paid" | null;
    employeeLimit: number | null;
  };
  seats: { used: number; limit: number | null } | null;
  plans: PlanView[];
  cycles: CycleView[];
  canSelfActivate: boolean;
  paymentProvider: "razorpay" | "cashfree" | null;
  trial: { days: number; employeeLimit: number | null };
}

interface CheckoutOrder {
  paymentId: string;
  provider: "razorpay" | "cashfree";
  orderId: string;
  amountRupees: number;
  razorpay?: {
    keyId: string;
    amountMinor: number;
    currency: string;
    name: string;
    description: string;
    prefill: { name: string; email: string; contact?: string };
  };
  cashfree?: { mode: "sandbox" | "production"; paymentSessionId: string };
}

type Tone = "amber" | "green" | "slate" | "red";

function statusCopy(d: BillingData): { tone: Tone; title: string; body: string } {
  const { access, trial, company } = d;
  if (access.state === "expired") {
    return access.endedAs === "trial"
      ? { tone: "red", title: "Your free trial has ended", body: "Choose a plan for your headcount to restore your workspace and its history." }
      : { tone: "red", title: "Your subscription has ended", body: "Renew to restore access for your team and your workspace history." };
  }
  if (access.state === "trial") {
    return {
      tone: "amber",
      title: `Free trial: ${access.daysLeft} ${access.daysLeft === 1 ? "day" : "days"} left`,
      body: `Your trial has no employee limit, managers included. Choose a plan that covers your headcount before it ends to keep going without a pause.`,
    };
  }
  if (access.state === "active") {
    return {
      tone: "green",
      title: `${company.subscriptionPlan} plan is active`,
      body: `${access.daysLeft} ${access.daysLeft === 1 ? "day" : "days"} left in this billing period. You can change plans at any time.`,
    };
  }
  return { tone: "slate", title: "No expiry on this account", body: "Your account is not on a time-limited plan." };
}

const TONES: Record<Tone, string> = {
  amber: "border-amber-200 bg-amber-50 text-amber-900",
  green: "border-emerald-200 bg-emerald-50 text-emerald-900",
  slate: "border-slate-200 bg-slate-50 text-slate-800",
  red: "border-rose-200 bg-rose-50 text-rose-900",
};

/** Loads a gateway's checkout script once. */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("The payment window could not be loaded. Check your connection and try again."));
    document.body.appendChild(s);
  });
}

export default function BillingPage() {
  const router = useRouter();
  const [data, setData] = useState<BillingData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await api<BillingData>("/api/billing");
      setData(res);
    } catch (e) {
      if (e instanceof Error && /unauthorized/i.test(e.message)) {
        router.replace("/login");
        return;
      }
      setError(e instanceof Error ? e.message : "Could not load billing details");
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  // Staff never see billing. Send them on to the app, or to the neutral page at the hard cutoff.
  useEffect(() => {
    if (!data || data.role === "company_admin") return;
    router.replace(data.access.staffLocked ? "/unavailable" : "/dashboard");
  }, [data, router]);

  const finish = (message: string) => {
    setSuccess(message);
    clearMe();
    router.push("/dashboard");
    router.refresh();
  };

  // Returning from Cashfree's hosted page: confirm the order with the gateway.
  useEffect(() => {
    const orderId = new URLSearchParams(window.location.search).get("cf_order_id");
    if (!orderId) return;
    window.history.replaceState(null, "", "/billing");
    void (async () => {
      setBusy(true);
      try {
        const res = await api<{ status: string }>("/api/billing/confirm", {
          method: "POST",
          body: JSON.stringify({ provider: "cashfree", orderId }),
        });
        if (res.status === "pending") setSuccess("Payment received. Your plan will be active in a moment.");
        else finish("Payment confirmed. Your subscription is active.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not confirm the payment");
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = async () => {
    setLoggingOut(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // best effort; the server clears the cookie on the next request anyway
    }
    clearMe();
    router.replace("/login");
  };

  /** Gateway checkout: the server quotes the price and creates the order; the browser opens the gateway's payment window. */
  const payWithGateway = async (planId: string, months: number) => {
    setBusy(true);
    setError("");
    try {
      const order = await api<CheckoutOrder>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ planId, months }),
      });

      if (order.razorpay) {
        await loadScript("https://checkout.razorpay.com/v1/checkout.js");
        const RZ = (window as unknown as { Razorpay: new (o: Record<string, unknown>) => { open: () => void } }).Razorpay;
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
              const res = await api<{ status: string }>("/api/billing/confirm", {
                method: "POST",
                body: JSON.stringify({
                  provider: "razorpay",
                  orderId: r.razorpay_order_id,
                  paymentId: r.razorpay_payment_id,
                  signature: r.razorpay_signature,
                }),
              });
              if (res.status === "pending") setSuccess("Payment received. Your plan will be active in a moment.");
              else finish("Payment confirmed. Your subscription is active.");
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not confirm the payment");
            } finally {
              setBusy(false);
            }
          },
          modal: { ondismiss: () => setBusy(false) },
        });
        rz.open();
        return;
      }

      if (order.cashfree) {
        await loadScript("https://sdk.cashfree.com/js/v3/cashfree.js");
        const CF = (window as unknown as {
          Cashfree: (o: { mode: string }) => { checkout: (o: { paymentSessionId: string; redirectTarget?: string }) => Promise<unknown> };
        }).Cashfree;
        await CF({ mode: order.cashfree.mode }).checkout({ paymentSessionId: order.cashfree.paymentSessionId, redirectTarget: "_self" });
        return; // the browser leaves for the payment page and comes back to /billing
      }
      throw new Error("This payment method is not available right now.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the payment");
      setBusy(false);
    }
  };

  /** Development / manual activation (only when the environment allows it). */
  const activateManually = async (planId: string, months: number) => {
    setBusy(true);
    setError("");
    try {
      await api("/api/billing/subscribe", { method: "POST", body: JSON.stringify({ planId, months }) });
      finish("Subscription active.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not activate the plan");
    } finally {
      setBusy(false);
    }
  };

  const isAdmin = data?.role === "company_admin";
  const canPay = !!data?.paymentProvider || !!data?.canSelfActivate;

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex min-w-0 items-center gap-2 font-bold text-slate-900">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
            <span className="truncate">TimeTrack Pro</span>
          </Link>
          <div className="flex shrink-0 items-center gap-3 text-sm">
            {data && !data.access.locked && (
              <Link href="/dashboard" className="font-semibold text-indigo-600">Dashboard</Link>
            )}
            <button type="button" onClick={logout} disabled={loggingOut} className="font-semibold text-slate-500">
              {loggingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))] pt-5 sm:space-y-6 sm:pt-8">
        {!data && !error && (
          <div className="flex items-center gap-3 text-slate-500">
            <Spinner /> Loading your plan…
          </div>
        )}
        {error && !data && (
          <Card className="p-6">
            <p className="text-sm font-medium text-rose-700">{error}</p>
            <Button className="mt-4" variant="secondary" onClick={() => void load()}>Try again</Button>
          </Card>
        )}

        {data && isAdmin && (
          <>
            {(() => {
              const copy = statusCopy(data);
              return (
                <div className={`rounded-2xl border p-4 sm:p-5 ${TONES[copy.tone]}`}>
                  <h1 className="text-lg font-extrabold sm:text-xl">{copy.title}</h1>
                  <p className="mt-1 text-sm leading-relaxed opacity-90">{copy.body}</p>
                  {data.seats && (
                    <p className="mt-3 text-sm font-semibold">
                      Seats used: {data.seats.used}
                      {data.seats.limit !== null ? ` of ${data.seats.limit}` : " (unlimited)"}
                    </p>
                  )}
                </div>
              );
            })()}

            {success && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{success}</p>}
            {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>}

            <section>
              <h2 className="mb-3 text-base font-bold text-slate-900 sm:text-lg">
                {data.access.locked ? "Choose a plan to restore access" : "Change your plan"}
              </h2>
              {!canPay && (
                <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Online payment is not switched on for this environment yet. Please contact support to activate your plan.
                </p>
              )}
              <Card className="p-4 sm:p-6">
                <PlanPicker
                  variant="checkout"
                  plans={data.plans}
                  cycles={data.cycles}
                  headcount={data.seats?.used ?? 0}
                  onChoose={data.paymentProvider ? payWithGateway : activateManually}
                  busy={busy}
                  payLabel={data.paymentProvider === "razorpay" ? "Pay with Razorpay" : data.paymentProvider === "cashfree" ? "Pay with Cashfree" : "Subscribe"}
                  unavailableReason={canPay ? null : "Online payment is not available yet."}
                />
              </Card>
              <p className="mt-4 text-center text-xs text-slate-500">
                Plans cover a number of seats. Every feature is included on every plan. Prices are in INR, excluding applicable taxes.
              </p>
            </section>
          </>
        )}
        {data && !isAdmin && data.access.locked && (
          <Card className="p-5">
            <p className="text-sm text-slate-600">Redirecting…</p>
          </Card>
        )}
      </main>
    </div>
  );
}
