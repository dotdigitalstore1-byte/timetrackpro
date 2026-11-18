"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { quoteCycle, tierFor, type CycleQuote } from "@/lib/billing-core";

export interface PlanView {
  id: string;
  name: string;
  employeeLimit: number;
  price: number;
  compareAtPrice: number | null;
  features: string[];
}

export interface CycleView {
  months: number;
  label: string;
  discountPercent: number;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function Quote({ quote }: { quote: CycleQuote }) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-3xl font-extrabold tracking-tight text-slate-900">{inr(quote.perMonth)}</span>
        <span className="text-sm font-medium text-slate-500">/ month</span>
        {quote.strikePerMonth !== null && (
          <s className="text-sm font-semibold text-slate-400" aria-label={`Was ${inr(quote.strikePerMonth)} a month`}>
            {inr(quote.strikePerMonth)}
          </s>
        )}
      </div>
      {quote.months > 1 && (
        <p className="mt-1 text-xs text-slate-500">
          Billed {inr(quote.total)} for {quote.months} months
          {quote.savings > 0 && <span className="ml-1 font-semibold text-emerald-600">· save {inr(quote.savings)}</span>}
        </p>
      )}
    </div>
  );
}

/** 1 / 6 / 12 month switch. Each option shows its discount so the saving is visible before choosing. */
function CycleToggle({ cycles, value, onChange }: { cycles: CycleView[]; value: number; onChange: (months: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Billing length" className="grid w-full grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1 sm:inline-flex sm:w-auto">
      {cycles.map((c) => {
        const active = c.months === value;
        return (
          <button
            key={c.months}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(c.months)}
            className={`min-h-11 rounded-xl px-2 py-2 text-xs font-semibold transition sm:px-4 sm:text-sm ${
              active ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600 active:bg-white/60"
            }`}
          >
            <span className="block">{c.label}</span>
            {c.discountPercent > 0 && (
              <span className="mt-0.5 block text-[10px] font-bold text-emerald-600 sm:inline sm:ml-1.5">−{c.discountPercent}%</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function FeatureList({ features }: { features: string[] }) {
  return (
    <ul className="space-y-2 text-sm text-slate-600">
      {features.map((f) => (
        <li key={f} className="flex gap-2">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span>{f}</span>
        </li>
      ))}
    </ul>
  );
}

/** Slider over the seat tiers. The price on screen follows the slider. */
function SeatSlider({ plans, index, onChange, headcount }: { plans: PlanView[]; index: number; onChange: (i: number) => void; headcount?: number }) {
  const current = plans[index];
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <p className="text-sm font-semibold text-slate-700">How many employees do you have?</p>
        <p className="text-3xl font-extrabold leading-none text-indigo-600">{current.employeeLimit}</p>
      </div>
      <input
        type="range"
        min={0}
        max={plans.length - 1}
        step={1}
        value={index}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Employee seats"
        aria-valuetext={`Up to ${current.employeeLimit} employees`}
        className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-full bg-indigo-100 accent-indigo-600"
      />
      <div className="mt-2 flex justify-between gap-0.5 text-[10px] font-semibold text-slate-400 sm:text-[11px]">
        {plans.map((p, i) => {
          // With many tiers, phones show every other number (plus the selected and the last one) so the row stays readable.
          // Every stop remains a tap target.
          const showLabel = plans.length <= 7 || i % 2 === 0 || i === index || i === plans.length - 1;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(i)}
              aria-label={`${p.employeeLimit} employees`}
              className={`min-w-0 flex-1 py-1 text-center ${i === index ? "text-indigo-700" : ""} ${headcount !== undefined && p.employeeLimit < headcount ? "line-through opacity-60" : ""}`}
            >
              <span className={showLabel ? "" : "hidden sm:inline"}>{p.employeeLimit}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface StorefrontProps {
  variant: "storefront";
  plans: PlanView[];
  cycles: CycleView[];
  ctaHref: string;
  ctaLabel: string;
}

interface CheckoutProps {
  variant: "checkout";
  plans: PlanView[];
  cycles: CycleView[];
  /** Current active headcount; plans with fewer seats cannot be chosen. */
  headcount: number;
  onChoose: (planId: string, months: number) => void | Promise<void>;
  busy?: boolean;
  /** Shown instead of the button when subscribing online is not available. */
  unavailableReason?: string | null;
  /** Label for the purchase button, for example "Pay with Razorpay". */
  payLabel?: string;
}

export default function PlanPicker(props: StorefrontProps | CheckoutProps) {
  const sortedPlans = useMemo(() => [...props.plans].sort((a, b) => a.employeeLimit - b.employeeLimit), [props.plans]);
  const cycles = useMemo(() => [...props.cycles].sort((a, b) => a.months - b.months), [props.cycles]);
  if (props.variant === "storefront") return <Storefront {...props} plans={sortedPlans} cycles={cycles} />;
  return <Checkout {...props} plans={sortedPlans} cycles={cycles} />;
}

function Storefront({ plans, cycles, ctaHref, ctaLabel }: StorefrontProps) {
  const [months, setMonths] = useState<number>(cycles[0]?.months ?? 1);
  const [index, setIndex] = useState(0);
  const cycle = cycles.find((c) => c.months === months) ?? cycles[0];
  const plan = plans[index];
  if (!plan || !cycle) return <p className="text-sm text-slate-500">Plans are being updated. Please check back shortly.</p>;
  const quote = quoteCycle(plan, cycle.months, cycle.discountPercent);

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <SeatSlider plans={plans} index={index} onChange={setIndex} />

        <div className="mt-6 space-y-4 rounded-2xl bg-gradient-to-br from-indigo-50 via-white to-white p-4 ring-1 ring-indigo-100 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold uppercase tracking-wide text-indigo-600">{plan.name}</p>
            <CycleToggle cycles={cycles} value={cycle.months} onChange={setMonths} />
          </div>
          <Quote quote={quote} />
          <div className="grid gap-4 sm:grid-cols-2">
            <FeatureList features={plan.features} />
            <div className="flex flex-col justify-end">
              <Link
                href={ctaHref}
                className="inline-flex min-h-12 items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[0.99]"
              >
                {ctaLabel}
              </Link>
              <p className="mt-2 text-center text-[11px] text-slate-500">No card needed to start</p>
            </div>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">All plans</p>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4">
          {plans.map((p, i) => {
            const q = quoteCycle(p, cycle.months, cycle.discountPercent);
            const selected = i === index;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-pressed={selected}
                className={`flex flex-col rounded-2xl border bg-white p-3.5 text-left transition sm:p-5 ${
                  selected ? "border-indigo-500 shadow-md shadow-indigo-100 ring-2 ring-indigo-200" : "border-slate-200 hover:border-indigo-200"
                }`}
              >
                <span className="text-[11px] font-bold uppercase tracking-wide text-indigo-600">{p.name}</span>
                <span className="mt-0.5 text-xs text-slate-500">Up to {p.employeeLimit}</span>
                <span className="mt-2 text-lg font-extrabold text-slate-900 sm:text-xl">{inr(q.perMonth)}</span>
                <span className="text-[11px] text-slate-500">/ month</span>
                {q.strikePerMonth !== null && <s className="mt-0.5 text-[11px] text-slate-400">{inr(q.strikePerMonth)}</s>}
              </button>
            );
          })}
        </div>
        <p className="mt-4 text-center text-xs text-slate-500">
          Prices in INR, excluding applicable taxes. Every feature is included on every plan. The only limit is the number of seats.
        </p>
      </div>
    </div>
  );
}

function Checkout({ plans, cycles, headcount, onChoose, busy, unavailableReason, payLabel }: CheckoutProps & { plans: PlanView[]; cycles: CycleView[] }) {
  const recommended = tierFor(plans, headcount);
  const [index, setIndex] = useState(() => {
    const i = recommended ? plans.findIndex((p) => p.id === recommended.id) : 0;
    return Math.max(0, i);
  });
  const [months, setMonths] = useState<number>(cycles[0]?.months ?? 1);
  const plan = plans[index];
  const cycle = cycles.find((c) => c.months === months) ?? cycles[0];
  if (!plan || !cycle) {
    return <p className="text-sm text-slate-500">No plans are available right now. Please check back soon.</p>;
  }

  const quote = quoteCycle(plan, cycle.months, cycle.discountPercent);
  const tooSmall = plan.employeeLimit < headcount;
  const disabledReason = unavailableReason ?? (tooSmall ? `This plan covers ${plan.employeeLimit}, but you have ${headcount} active people.` : null);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <SeatSlider plans={plans} index={index} onChange={setIndex} headcount={headcount} />
        <p className="mt-4 text-xs text-slate-500">
          You currently have <span className="font-semibold text-slate-700">{headcount}</span> active {headcount === 1 ? "person" : "people"} (employees and managers). The company admin does not use a seat.
        </p>
      </section>

      <section className="rounded-2xl border-2 border-indigo-500 bg-white p-4 shadow-lg shadow-indigo-100/60 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-indigo-600">{plan.name}</p>
            <p className="text-sm text-slate-500">Up to {plan.employeeLimit} employees</p>
          </div>
          {recommended?.id === plan.id && (
            <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">Recommended</span>
          )}
        </div>

        <div className="mt-5">
          <p className="mb-2 text-sm font-semibold text-slate-700">Billing length</p>
          <CycleToggle cycles={cycles} value={cycle.months} onChange={setMonths} />
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-4">
            <Quote quote={quote} />
            <p className="mt-3 text-sm text-slate-600">
              Total for {cycle.label}: <span className="font-bold text-slate-900">{inr(quote.total)}</span>
            </p>
            {quote.savings > 0 && <p className="mt-1 text-sm font-semibold text-emerald-600">You save {inr(quote.savings)}</p>}
          </div>
          <FeatureList features={plan.features} />
        </div>

        <div className="mt-6">
          {disabledReason && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">{disabledReason}</p>}
          <Button className="w-full" size="lg" disabled={!!disabledReason} loading={busy} onClick={() => void onChoose(plan.id, cycle.months)}>
            {payLabel ?? "Subscribe"} · {inr(quote.total)}
          </Button>
        </div>
      </section>
    </div>
  );
}
