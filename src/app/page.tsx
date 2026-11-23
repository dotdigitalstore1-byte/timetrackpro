import Link from "next/link";
import type { Metadata } from "next";
import { getAuthAllowLocked } from "@/lib/auth";
import { loadPricing, serializeCycle, serializePlan } from "@/lib/billing";
import { TRIAL_DAYS } from "@/lib/billing-core";
import { entryPathFor } from "@/lib/home";
import PlanPicker from "@/components/PlanPicker";
import { BrandMark } from "@/components/Brand";

export const metadata: Metadata = {
  title: "Dotinout · Attendance, leave and payroll for growing teams",
  description: `Photo-verified attendance, leave, payroll and reports in one place. Start a ${TRIAL_DAYS}-day free trial. No credit card.`,
};

const FEATURES = [
  {
    title: "Photo-verified attendance",
    body: "Employees punch in and out with a live photo and a GPS check. Every correction is recorded with who changed it and why.",
  },
  {
    title: "Leave with approvals",
    body: "Casual and medical leave, running balances, and one- or two-level approvals that match how your company works.",
  },
  {
    title: "Payroll you can explain",
    body: "Attendance-based salary, configurable deductions, salary holds and day-by-day logs. Employees download their own payslips.",
  },
  {
    title: "Rules that apply themselves",
    body: "Grace time, late marks, half days, early leave and overtime. Each rule shows a worked example before you switch it on.",
  },
  {
    title: "Many sites, many teams",
    body: "Unlimited departments and work locations, with a shift for every employee and geofences for every site.",
  },
  {
    title: "Managers with the right powers",
    body: "Choose what each manager can do, from approving leave to viewing salaries, and limit each one to their own team.",
  },
  {
    title: "Reports ready to share",
    body: "Daily, weekly, monthly and yearly reports, exported to Excel, CSV or PDF, with a department filter.",
  },
  {
    title: "Policies people actually read",
    body: "Publish an agreement that employees must accept before they punch in. Handle notice periods from resignation to last day.",
  },
];

const STEPS = [
  { title: "Create your workspace", body: "Enter your company details and confirm the email code we send you. No card needed." },
  { title: "Add your team", body: `Add as many people as you need, managers included, for ${TRIAL_DAYS} days.` },
  { title: "Choose a plan for your headcount", body: "When the trial ends, pick the seat count that fits and the billing length you prefer." },
];

const FAQ = [
  {
    q: "Do I need a credit card to start?",
    a: "No. The free trial needs only an email address you can verify with a one-time code.",
  },
  {
    q: "What counts as a seat?",
    a: "Every active employee and manager. The company admin account does not use a seat. Deactivated people free their seat straight away.",
  },
  {
    q: "What happens when the trial ends?",
    a: "Admin access pauses the day the trial ends. Your team can keep punching in and out for five more days while you choose a plan that covers your headcount. After that, access pauses for everyone until you subscribe. Subscribing restores access straight away, and no data is deleted.",
  },
  {
    q: "Can I change plans later?",
    a: "Yes. You can move to a larger plan at any time. A new billing period starts from the day you change.",
  },
];

function Logo() {
  return (
    <span className="flex items-center gap-2">
      <BrandMark className="h-9 w-9 rounded-xl" />
      <span className="text-lg font-extrabold leading-none tracking-tight text-white">
        Dot<span className="text-indigo-300">in</span><span className="text-violet-300">out</span>
      </span>
    </span>
  );
}

export default async function LandingPage() {
  const [ctx, pricing] = await Promise.all([getAuthAllowLocked(), loadPricing()]);
  const dashboardHref = ctx ? entryPathFor({ role: ctx.user.role, locked: ctx.locked }) : "/dashboard";

  return (
    <div className="min-h-dvh bg-white text-slate-900">
      <header className="bg-gradient-to-br from-indigo-700 via-indigo-600 to-slate-900 text-white">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <Logo />
          <div className="flex items-center gap-2 text-sm font-semibold">
            <a href="#features" className="hidden px-3 py-2 text-indigo-100 hover:text-white sm:inline">Features</a>
            <a href="#pricing" className="hidden px-3 py-2 text-indigo-100 hover:text-white sm:inline">Pricing</a>
            {ctx ? (
              <Link href={dashboardHref} className="rounded-xl bg-white px-4 py-2 text-indigo-700 shadow-sm hover:bg-indigo-50">
                Open dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="px-3 py-2 text-indigo-100 hover:text-white">Sign in</Link>
                <Link href="/register" className="rounded-xl bg-white px-4 py-2 text-indigo-700 shadow-sm hover:bg-indigo-50">
                  Start free trial
                </Link>
              </>
            )}
          </div>
        </nav>

        <div className="mx-auto max-w-6xl px-5 pb-16 pt-10 text-center sm:pb-20 sm:pt-20">
          <p className="mx-auto mb-5 inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-indigo-100 ring-1 ring-white/20">
            {TRIAL_DAYS}-day free trial · unlimited employees · no credit card
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">
            Attendance, leave and payroll that your team can trust
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-indigo-100 sm:text-lg">
            Photo-verified punches, geofenced sites, transparent payroll and reports you can export in one click. Every feature is
            included on every plan. You only pay for seats.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href={ctx ? dashboardHref : "/register"}
              className="w-full rounded-xl bg-white px-6 py-3 text-center text-sm font-bold text-indigo-700 shadow-lg shadow-indigo-900/20 hover:bg-indigo-50 sm:w-auto"
            >
              {ctx ? "Go to your dashboard" : `Start your ${TRIAL_DAYS}-day free trial`}
            </Link>
            <a href="#pricing" className="w-full rounded-xl px-6 py-3 text-center text-sm font-semibold text-white ring-1 ring-white/30 hover:bg-white/10 sm:w-auto">
              See pricing
            </a>
          </div>
        </div>
      </header>

      <section id="features" className="mx-auto max-w-6xl px-4 py-14 sm:px-5 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight">Everything in one place</h2>
          <p className="mt-3 text-slate-600">The tools your HR, admins and managers need, without juggling spreadsheets.</p>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:mt-12 sm:gap-5 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-indigo-200 hover:shadow-md sm:p-5">
              <div className="mb-2.5 flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 sm:mb-3 sm:h-10 sm:w-10">
                <span className="text-sm font-extrabold">{f.title.charAt(0)}</span>
              </div>
              <h3 className="text-sm font-bold leading-snug text-slate-900 sm:text-base">{f.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600 sm:mt-2 sm:text-sm">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-slate-50 py-20">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title}>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">{i + 1}</span>
              <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-4 py-14 sm:px-5 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight">Simple pricing, per seat</h2>
          <p className="mt-3 text-slate-600">
            Start free for {TRIAL_DAYS} days. Then choose the plan that fits your headcount.
          </p>
        </div>
        <div className="mt-8 sm:mt-12">
          <PlanPicker
            variant="storefront"
            plans={pricing.plans.map(serializePlan)}
            cycles={pricing.cycles.map(serializeCycle)}
            ctaHref={ctx ? dashboardHref : "/register"}
            ctaLabel={ctx ? "Open dashboard" : `Start ${TRIAL_DAYS}-day free trial`}
          />
        </div>
      </section>

      <section className="bg-slate-50 py-20">
        <div className="mx-auto max-w-3xl px-5">
          <h2 className="text-center text-3xl font-extrabold tracking-tight">Questions</h2>
          <div className="mt-10 divide-y divide-slate-200 rounded-2xl bg-white ring-1 ring-slate-200">
            {FAQ.map((item) => (
              <details key={item.q} className="group p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-slate-900">
                  {item.q}
                  <span className="ml-4 text-indigo-600 transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-gradient-to-br from-indigo-700 via-indigo-600 to-slate-900 py-16 text-white">
        <div className="mx-auto max-w-3xl px-5 text-center">
          <h2 className="text-3xl font-extrabold tracking-tight">Set up your workspace in minutes</h2>
          <p className="mt-3 text-indigo-100">Verify your email, add your first people and punch in today.</p>
          <Link href={ctx ? dashboardHref : "/register"} className="mt-7 inline-flex rounded-xl bg-white px-6 py-3 text-sm font-bold text-indigo-700 hover:bg-indigo-50">
            {ctx ? "Go to your dashboard" : `Start your ${TRIAL_DAYS}-day free trial`}
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-200 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 text-sm text-slate-500 sm:flex-row">
          <span>© {new Date().getFullYear()} Dotinout (DIO)</span>
          <div className="flex gap-4">
            <Link href="/login" className="hover:text-slate-800">Sign in</Link>
            <Link href="/register" className="hover:text-slate-800">Register</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
