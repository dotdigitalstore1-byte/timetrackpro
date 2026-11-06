"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { api, useMe } from "@/lib/client";
import { Button, Card, EmptyState, ErrorBanner, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { addDays, cyclePeriod, currentCycleKey, dateKey } from "@/lib/payroll";
import { formatDayKey, formatNumber } from "@/lib/utils";

// Everything is held as strings while editing so half-typed numbers never turn into NaN.
const FIELDS = [
  "shiftStart", "shiftEnd",
  "graceMinutes", "lateThresholdMinutes", "lateDeductionType", "lateDeductionValue",
  "lateMarksLimit", "lateMarksPenaltyDays",
  "earlyLeaveGraceMinutes", "earlyLeaveHalfDayMinutes", "earlyLeaveDeductionType", "earlyLeaveDeductionValue",
  "halfDayDeductionType", "halfDayDeductionValue", "leaveDeductionType", "leaveDeductionValue", "unapprovedHoldDays",
  "overtimeMinMinutes", "overtimeRate", "overtimeMaxMinutesPerDay",
  "extraPayRate",
  "salaryCycleStartDay", "salaryPayDelayDays",
] as const;

type Form = Record<(typeof FIELDS)[number], string> & {
  overtimeEnabled: boolean;
  extraPayEnabled: boolean;
  leaveAccrualMode: "carry" | "lapse";
};

const DEDUCTION_TYPES = [
  { value: "percentage", label: "% of daily rate" },
  { value: "fixed", label: "Fixed amount" },
];

/** Salaries are always worked out on this many days, so the daily rate is basic ÷ 30 in every month. */
const SALARY_BASE_DAYS = 30;
/** A cycle can start on any day from 1 to 28 (every month has those days, so cycles never skip or overlap). */
const MIN_START_DAY = 1;
const MAX_START_DAY = 28;

function toTime(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}
const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? 0 : Number(v));
const isValidStartDay = (v: string) => {
  const n = Number(v);
  return v.trim() !== "" && Number.isInteger(n) && n >= MIN_START_DAY && n <= MAX_START_DAY;
};

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card>
      <h3 className="font-bold text-slate-900">{title}</h3>
      {hint && <p className="mb-3 mt-0.5 text-xs text-slate-500">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </Card>
  );
}

function Example({ children }: { children: ReactNode }) {
  return <div className="mt-3 rounded-xl bg-indigo-50 px-3 py-2.5 text-xs leading-relaxed text-indigo-900">{children}</div>;
}

function Toggle({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={`mb-3 flex min-h-11 w-full items-center justify-between rounded-xl border px-3.5 py-2 text-sm font-semibold ${on ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-slate-300 bg-white text-slate-600"}`}
    >
      <span>{label}</span>
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${on ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-500"}`}>
        {on ? "ON" : "OFF"}
      </span>
    </button>
  );
}

export default function RulesPage() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.user.role === "company_admin";
  const currency = me?.settings?.currency ?? "";

  const [form, setForm] = useState<Form | null>(null);
  const [savedStartDay, setSavedStartDay] = useState("1");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const data = await api<{ settings: Record<string, unknown> | null }>("/api/settings");
      const s = data.settings;
      if (!s) throw new Error("Company settings are not available.");
      const f: Record<string, string> = {};
      for (const k of FIELDS) f[k] = String(s[k] ?? "");
      setForm({
        ...(f as Form),
        overtimeEnabled: !!s.overtimeEnabled,
        extraPayEnabled: !!s.extraPayEnabled,
        leaveAccrualMode: s.leaveAccrualMode === "lapse" ? "lapse" : "carry",
      });
      setSavedStartDay(String(s.salaryCycleStartDay ?? "1"));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load rules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
    else if (!meLoading) setLoading(false);
  }, [isAdmin, meLoading, load]);

  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const save = async () => {
    if (!form) return;
    if (!isValidStartDay(form.salaryCycleStartDay)) {
      setError(`The salary cycle must start on a day from ${MIN_START_DAY} to ${MAX_START_DAY}.`);
      return;
    }
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const settings: Record<string, unknown> = {
        overtimeEnabled: form.overtimeEnabled,
        extraPayEnabled: form.extraPayEnabled,
        leaveAccrualMode: form.leaveAccrualMode,
      };
      for (const k of FIELDS) {
        if (k === "shiftStart" || k === "shiftEnd") continue; // default shift lives on the Settings page
        const text = k.endsWith("Type");
        settings[k] = text ? form[k] : num(form[k]);
      }
      await api("/api/settings", { method: "POST", body: JSON.stringify({ settings }) });
      setMessage("Rules saved. They apply to new punches and to every salary cycle that is not finalized yet.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // ---- live examples, computed from what is currently typed
  const example = useMemo(() => {
    if (!form) return null;
    const start = minutesOf(form.shiftStart || "09:00");
    const end = minutesOf(form.shiftEnd || "18:00");
    const grace = num(form.graceMinutes);
    const late = num(form.lateThresholdMinutes);
    const eGrace = num(form.earlyLeaveGraceMinutes);
    const eHalf = num(form.earlyLeaveHalfDayMinutes);
    const sd = isValidStartDay(form.salaryCycleStartDay) ? num(form.salaryCycleStartDay) : 1;
    const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
    const key = currentCycleKey(today, sd);
    const period = cyclePeriod(key.year, key.month, sd);
    const nextKey = currentCycleKey(addDays(period.end, 1), sd);
    const nextPeriod = cyclePeriod(nextKey.year, nextKey.month, sd);
    return {
      onTimeUntil: toTime(start + grace),
      lateFrom: toTime(start + grace + 1),
      lateUntil: toTime(start + late),
      halfAfter: toTime(start + late),
      start: toTime(start),
      end: toTime(end),
      earlyOkFrom: toTime(end - eGrace),
      earlyHalfBefore: toTime(end - eHalf),
      eHalf,
      sd,
      periodStart: dateKey(period.start),
      periodEnd: dateKey(period.end),
      nextStart: dateKey(nextPeriod.start),
      nextEnd: dateKey(nextPeriod.end),
      payDate: dateKey(addDays(period.end, num(form.salaryPayDelayDays))),
    };
  }, [form]);

  if (meLoading || (loading && isAdmin)) return <div className="flex justify-center py-16"><Spinner /></div>;
  if (!isAdmin) return <EmptyState message="Only company admins can manage rules." />;
  if (!form || !example) {
    return (
      <div>
        <PageHeader title="Rules" subtitle="Attendance, deductions, overtime and salary cycle" />
        <ErrorBanner message={loadError || "Rules are not available."} onRetry={load} />
      </div>
    );
  }

  const startDayValid = isValidStartDay(form.salaryCycleStartDay);
  const cycleLabel = (d: number) => (d === 1 ? "Calendar month (1st → month end)" : `${ordinal(d)} → ${ordinal(d - 1)}`);
  const presetDays = [1, 6, 11, 16, 21, 26];
  const dailyExample = 30000 / SALARY_BASE_DAYS; // illustration only

  return (
    <div>
      <PageHeader
        title="Rules"
        subtitle="How lateness, early leave, overtime and salary are handled for your company"
        action={<Button size="sm" onClick={save} loading={saving}>Save rules</Button>}
      />

      {message && <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{message}</p>}
      {error && <ErrorBanner message={error} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Section title="Late arrival &amp; cool-off time" hint="A short window after shift start in which a late punch still counts as on time.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="Cool-off time (minutes)" type="number" value={form.graceMinutes} onChange={(v) => set({ graceMinutes: v })} />
              <Input label="Half-day after (minutes late)" type="number" value={form.lateThresholdMinutes} onChange={(v) => set({ lateThresholdMinutes: v })} />
              <Select label="Late deduction type" value={form.lateDeductionType} onChange={(v) => set({ lateDeductionType: v })} options={DEDUCTION_TYPES} />
              <Input label={form.lateDeductionType === "fixed" ? `Late deduction (${currency})` : "Late deduction (%)"} type="number" value={form.lateDeductionValue} onChange={(v) => set({ lateDeductionValue: v })} />
            </div>
            <Example>
              For a <b>{example.start}</b> shift with a <b>{num(form.graceMinutes)}-minute</b> cool-off: punching in up to <b>{example.onTimeUntil}</b> still
              gets the <b>full day</b> (no deduction). <b>{example.lateFrom}–{example.lateUntil}</b> is marked <b>late</b>. After <b>{example.halfAfter}</b> it
              becomes a <b>half day</b>. Each employee&apos;s own punch-in time is used, so a 14:00 shift gets the same cool-off from 14:00.
            </Example>
          </Section>

          <Section title="Late marks" hint="Optional: every few late days cost extra salary on top of the per-late deduction. Set 0 to turn off.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="Every … late days" type="number" value={form.lateMarksLimit} onChange={(v) => set({ lateMarksLimit: v })} />
              <Input label="… cost this many days of salary" type="number" step="0.25" value={form.lateMarksPenaltyDays} onChange={(v) => set({ lateMarksPenaltyDays: v })} />
            </div>
            {num(form.lateMarksLimit) > 0 ? (
              <Example>Every <b>{num(form.lateMarksLimit)}</b> late days in a cycle deduct <b>{num(form.lateMarksPenaltyDays)}</b> day(s) of salary.</Example>
            ) : (
              <p className="mt-2 text-[11px] text-slate-400">Off.</p>
            )}
          </Section>

          <Section title="Early leave" hint="Leaving before the shift ends. A cool-off lets people leave a few minutes early without penalty.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="Early-leave cool-off (minutes)" type="number" value={form.earlyLeaveGraceMinutes} onChange={(v) => set({ earlyLeaveGraceMinutes: v })} />
              <Input label="Half day if earlier than (minutes, 0 = off)" type="number" value={form.earlyLeaveHalfDayMinutes} onChange={(v) => set({ earlyLeaveHalfDayMinutes: v })} />
              <Select label="Early-leave deduction type" value={form.earlyLeaveDeductionType} onChange={(v) => set({ earlyLeaveDeductionType: v })} options={DEDUCTION_TYPES} />
              <Input label={form.earlyLeaveDeductionType === "fixed" ? `Deduction per day (${currency})` : "Deduction per day (%)"} type="number" value={form.earlyLeaveDeductionValue} onChange={(v) => set({ earlyLeaveDeductionValue: v })} />
            </div>
            <Example>
              For a shift ending at <b>{example.end}</b>: leaving from <b>{example.earlyOkFrom}</b> onward is fine.
              Leaving earlier counts as <b>early leave</b>
              {example.eHalf > 0 ? <>, and leaving before <b>{example.earlyHalfBefore}</b> becomes a <b>half day</b></> : null}.
              The deduction is <b>0 by default</b>, so set an amount if you want early leave to cost salary.
            </Example>
          </Section>

          <Section title="Overtime" hint="Pay extra for time worked after the shift ends.">
            <Toggle label="Pay overtime" on={form.overtimeEnabled} onToggle={() => set({ overtimeEnabled: !form.overtimeEnabled })} />
            {form.overtimeEnabled && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Input label="Counts after (minutes)" type="number" value={form.overtimeMinMinutes} onChange={(v) => set({ overtimeMinMinutes: v })} />
                  <Input label="Pay rate (× hourly)" type="number" step="0.25" value={form.overtimeRate} onChange={(v) => set({ overtimeRate: v })} />
                  <Input label="Max per day (minutes)" type="number" value={form.overtimeMaxMinutesPerDay} onChange={(v) => set({ overtimeMaxMinutesPerDay: v })} />
                </div>
                <Example>
                  Staying at least <b>{num(form.overtimeMinMinutes)} min</b> past shift end counts, up to <b>{num(form.overtimeMaxMinutesPerDay)} min</b> a day,
                  paid at <b>{num(form.overtimeRate)}×</b> the hourly rate (daily rate ÷ shift hours).
                </Example>
              </>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Half-day, leave &amp; unapproved absence">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select label="Half-day deduction type" value={form.halfDayDeductionType} onChange={(v) => set({ halfDayDeductionType: v })} options={DEDUCTION_TYPES} />
              <Input label={form.halfDayDeductionType === "fixed" ? `Half-day deduction (${currency})` : "Half-day deduction (%)"} type="number" value={form.halfDayDeductionValue} onChange={(v) => set({ halfDayDeductionValue: v })} />
              <Select label="Approved-leave deduction type" value={form.leaveDeductionType} onChange={(v) => set({ leaveDeductionType: v })} options={DEDUCTION_TYPES} />
              <Input label={form.leaveDeductionType === "fixed" ? `Leave deduction (${currency})` : "Leave deduction (%)"} type="number" value={form.leaveDeductionValue} onChange={(v) => set({ leaveDeductionValue: v })} />
              <Input label="Unapproved-absence hold (days per occurrence)" type="number" value={form.unapprovedHoldDays} onChange={(v) => set({ unapprovedHoldDays: v })} />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
              Unapproved absences are unpaid days, plus a temporary hold that an admin can release. Approved leave is deducted at the
              leave rate above, but only the days not covered by comp-off (see below).
            </p>
          </Section>

          <Section title="Salary base: fixed 30-day month" hint="The salary never changes with the calendar. Every month is divided by 30.">
            <Example>
              For example, a basic salary of <b>{currency}30,000</b> gives a daily rate of <b>{currency}{formatNumber(dailyExample, 0)}</b> in every cycle,
              whether it has 28, 30 or 31 days. Sundays and holidays are already part of the 30 paid days, so they are never deducted.
              Each unpaid day costs one daily rate, and a 2-day unpaid leave costs <b>{currency}{formatNumber(dailyExample * 2, 0)}</b>.
            </Example>
          </Section>

          <Section title="Weekly-off work &amp; comp-off" hint="Working on a weekly off (Sunday by default) earns one comp-off day, which must be used in the same salary cycle.">
            <Example>
              <b>Leave compensation:</b> a Sunday worked in the same cycle as a leave pays for that leave, so the leave day is paid instead of deducted.
              It works the same way whether the Sunday comes before or after the leave.
              <br />
              <b>Lapsing:</b> comp-off that is not used by the last day of the cycle lapses, unless Extra pay is switched on below.
            </Example>
            <div className="mt-3">
              <Toggle
                label="Extra pay for unused comp-off"
                on={form.extraPayEnabled}
                onToggle={() => set({ extraPayEnabled: !form.extraPayEnabled })}
              />
              {form.extraPayEnabled ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input label="Extra pay per unused day (× daily rate)" type="number" step="0.25" value={form.extraPayRate} onChange={(v) => set({ extraPayRate: v })} />
                </div>
              ) : null}
            </div>
            <Example>
              For example: an employee works <b>2 Sundays</b> and takes <b>1 leave</b> in the same cycle. The leave is paid by one Sunday.
              The other Sunday is unused comp-off:{" "}
              {form.extraPayEnabled ? (
                <>paid as extra pay, <b>+{currency}{formatNumber(dailyExample * num(form.extraPayRate), 0)}</b> on a {currency}30,000 salary.</>
              ) : (
                <>it lapses with no pay.</>
              )}
            </Example>
          </Section>

          <Section
            title="Leave accrual"
            hint="Each employee earns 1 leave per month, starting from their joining month. A new joiner in November sees 1 leave, not 12."
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                { value: "carry" as const, title: "Carry forward", text: "Unused leave accumulates and can be used later in the year." },
                { value: "lapse" as const, title: "Lapse monthly", text: "The month's leave must be taken in that month, or it lapses." },
              ].map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => set({ leaveAccrualMode: o.value })}
                  className={`rounded-xl border p-3 text-left ${
                    form.leaveAccrualMode === o.value ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white"
                  }`}
                >
                  <p className="text-sm font-bold text-slate-900">{o.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{o.text}</p>
                </button>
              ))}
            </div>
            <Example>
              All accrued leave needs admin approval and is recorded as <b>Casual</b> or <b>Medical</b> leave. Approved leave beyond the
              available balance is still allowed and is deducted as unpaid leave.
            </Example>
          </Section>

          <Section title="Salary cycle" hint="The period each salary covers, and when it is paid.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                label={`Cycle starts on day (${MIN_START_DAY}–${MAX_START_DAY})`}
                type="number"
                value={form.salaryCycleStartDay}
                onChange={(v) => set({ salaryCycleStartDay: v })}
              />
              <Input label="Pay salary … days after cycle ends" type="number" value={form.salaryPayDelayDays} onChange={(v) => set({ salaryPayDelayDays: v })} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {presetDays.map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={num(form.salaryCycleStartDay) === d ? "primary" : "secondary"}
                  onClick={() => set({ salaryCycleStartDay: String(d) })}
                >
                  {cycleLabel(d)}
                </Button>
              ))}
            </div>
            {!startDayValid && (
              <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2.5 text-xs font-medium text-rose-700">
                Enter a whole day from {MIN_START_DAY} to {MAX_START_DAY}. Days 29 to 31 are not offered because they do not exist in every month.
              </p>
            )}
            {form.salaryCycleStartDay !== savedStartDay && startDayValid && (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-medium text-amber-800">
                Changing the cycle: salaries you already finalized keep their original dates, but any cycle not yet finalized is recalculated with the new dates.
                To avoid overlapping or skipped days, change this right after you finalize a cycle.
              </p>
            )}
            <Example>
              A cycle runs from its start day up to the day before the next one. Day 1 means the calendar month. Day 26 means
              <b> 26th → 25th</b>.
              Current cycle: <b>{formatDayKey(example.periodStart)} – {formatDayKey(example.periodEnd)}</b>, paid on <b>{formatDayKey(example.payDate)}</b>.
              Next cycle: <b>{formatDayKey(example.nextStart)} – {formatDayKey(example.nextEnd)}</b>.
              A cycle can only be finalized after its last day. Salary is set per employee on the <Link href="/employees" className="font-bold underline">Employees</Link> page.
            </Example>
          </Section>
        </div>
      </div>

      <div className="mt-4">
        <Button onClick={save} loading={saving} className="w-full sm:w-auto">Save rules</Button>
      </div>
    </div>
  );
}
