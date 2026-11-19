"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { api, useMe } from "@/lib/client";
import { Button, Card, EmptyState, ErrorBanner, Input, PageHeader, Select, Spinner } from "@/components/ui";
import {
  addDays,
  cyclePeriod,
  currentCycleKey,
  dailyRateDivisor,
  dateKey,
  salaryBasisOf,
  salaryDateOf,
  type SalaryBasis,
} from "@/lib/payroll";
import { formatDayKey, formatNumber, CURRENCY } from "@/lib/utils";
import { weekdayOf } from "@/lib/attendance-days";
import {
  RULE_BY_ID,
  RULES,
  SALARY_BASIS_OPTIONS,
  WEEKDAYS,
  basisLabel,
  changesBetween,
  money,
  ordinal,
  parseOffDays,
  previewDay,
  rulesMatching,
  validateRules,
  type PreviewTone,
  type RuleCategory,
} from "@/lib/rules-check";

// Everything is held as strings while editing so half-typed numbers never turn into NaN.
const FIELDS = [
  "shiftStart", "shiftEnd",
  "graceMinutes", "lateThresholdMinutes", "lateDeductionType", "lateDeductionValue",
  "lateMarksLimit", "lateMarksPenaltyDays",
  "earlyLeaveGraceMinutes", "earlyLeaveHalfDayMinutes", "earlyLeaveDeductionType", "earlyLeaveDeductionValue",
  "halfDayDeductionType", "halfDayDeductionValue", "leaveDeductionType", "leaveDeductionValue", "unapprovedHoldDays",
  "overtimeMinMinutes", "overtimeRate", "overtimeMaxMinutesPerDay",
  "extraPayRate",
  "holidayDeductionTriggerCount",
  "absentAfterPercent",
  "salaryCycleStartDay", "salaryDisbursementDay",
] as const;

type Form = Record<(typeof FIELDS)[number], string> & {
  overtimeEnabled: boolean;
  extraPayEnabled: boolean;
  holidayDeductionEnabled: boolean;
  absentAfterPercentEnabled: boolean;
  midCycleSlipEnabled: boolean;
  leaveAccrualMode: "carry" | "lapse";
  salaryHoldEnabled: boolean;
  weeklyOff: string; // comma list of JS weekdays, 0 = Sunday … 6 = Saturday
  dailyRateBasis: SalaryBasis;
};

interface Holiday {
  id: string;
  holidayDate: string;
  name: string;
}

const DEDUCTION_TYPES = [
  { value: "percentage", label: "% of daily rate" },
  { value: "fixed", label: "Fixed amount" },
];

/** A cycle can start on any day from 1 to 28 (every month has those days, so cycles never skip or overlap). */
const MIN_START_DAY = 1;
const MAX_START_DAY = 28;
/** The sample salary used in previews until the admin types another. It is never saved. */
const DEFAULT_SAMPLE_SALARY = "30000";

function toTime(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? 0 : Number(v));
const isValidStartDay = (v: string) => {
  const n = Number(v);
  return v.trim() !== "" && Number.isInteger(n) && n >= MIN_START_DAY && n <= MAX_START_DAY;
};

/** Moves a salary-cycle key (YYYY-MM) forward or back by whole months. */
function shiftCycleKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Shared state for the whole page: expand/collapse all, jump-to-rule, and which rules the search shows. */
interface PageBus {
  open: boolean;
  stamp: number;
  jumpId: string;
  jumpStamp: number;
  searching: boolean;
  visibleIds: ReadonlySet<string>;
}
const PageBusContext = createContext<PageBus>({
  open: false,
  stamp: 0,
  jumpId: "",
  jumpStamp: 0,
  searching: false,
  visibleIds: new Set<string>(),
});

interface CategoryMeta {
  key: RuleCategory;
  anchor: string;
  chip: string;
  title: string;
  note: string;
  icon: string;
}

/** Six groups, in the order an admin usually reads them: time, pay, extras, days off, calendar, records. */
const CATEGORIES: CategoryMeta[] = [
  {
    key: "hours",
    anchor: "rules-hours",
    chip: "Working hours",
    title: "Working hours & punches",
    note: "When a punch counts as on time, late, a half day, or early leave.",
    icon: "M12 6v6l4 2m5-2a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    key: "pay",
    anchor: "rules-pay",
    chip: "Daily pay & deductions",
    title: "Daily pay & deductions",
    note: "How a day's pay is worked out, and what late, half-day and unapproved absence cost.",
    icon: "M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    key: "extra",
    anchor: "rules-extra",
    chip: "Overtime & extras",
    title: "Overtime, comp-off & holiday cuts",
    note: "Extra pay for time after shift end, pay for weekly-off work, and cuts for unauthorized leave.",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
  },
  {
    key: "days",
    anchor: "rules-days",
    chip: "Weekly offs & holidays",
    title: "Weekly offs & paid holidays",
    note: "The days your company is closed, every week and on special dates.",
    icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2zm7-6.5l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4L12 14.5z",
  },
  {
    key: "cycle",
    anchor: "rules-cycle",
    chip: "Salary cycle & leave",
    title: "Salary cycle, leave & slips",
    note: "Which dates each salary covers, how leave builds up, and when salary slips can be requested.",
    icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  },
  {
    key: "records",
    anchor: "rules-records",
    chip: "Records & privacy",
    title: "Records & privacy",
    note: "Salary slips, and how long attendance photos and records are kept.",
    icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
  },
];

const GLOSSARY: { term: string; text: string }[] = [
  { term: "Daily rate", text: "What one day of pay is worth: basic salary divided by the number shown in Daily pay & deductions. Every per-day deduction uses it." },
  { term: "Working days", text: "The days in a salary cycle that are not weekly offs. Paid holidays still count as working days." },
  { term: "Cool-off", text: "A few minutes after shift start (or before shift end, when leaving) that do not count as late or early leave." },
  { term: "Late", text: "A punch-in after the cool-off but before the half-day cut-off." },
  { term: "Half day", text: "A punch-in after the half-day cut-off, or leaving earlier than the early-leave half-day limit." },
  { term: "Early leave", text: "Leaving before shift end by more than the early-leave cool-off." },
  { term: "Auto-absent", text: "A punch-in after a set share of the shift has passed. The day is recorded as absent, not late." },
  { term: "Weekly off", text: "A day the company is closed every week. It is paid, and working on it earns a comp-off day." },
  { term: "Comp-off", text: "One day of credit earned for working a weekly off. It is used against approved leave in the same salary cycle." },
  { term: "Paid holiday", text: "A one-off company holiday, such as a festival. It is paid, and nothing is deducted for it." },
  { term: "Approved leave", text: "Leave an admin has approved. A day with no punch and no approved leave is an unapproved absence." },
  { term: "Salary cycle", text: "The period one salary covers, for example 26 Oct to 25 Nov." },
  { term: "Salary date", text: "The day salary is paid, on the chosen day of the month after the cycle ends." },
  { term: "Salary hold", text: "Delays the pay date for unapproved absence days. The amount is not reduced." },
  { term: "Finalized", text: "A cycle whose salary is locked. Its holidays and pay no longer change, and it keeps the daily rate it was worked out with." },
];

type StatusTone = "on" | "off" | "neutral";

const STATUS_STYLES: Record<StatusTone, { pill: string; dot: string }> = {
  on: { pill: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  off: { pill: "bg-slate-100 text-slate-500", dot: "bg-slate-300" },
  neutral: { pill: "bg-indigo-50 text-indigo-700", dot: "bg-indigo-400" },
};

const PREVIEW_STYLES: Record<PreviewTone, { box: string; title: string }> = {
  good: { box: "border-emerald-200 bg-emerald-50", title: "text-emerald-800" },
  warn: { box: "border-amber-200 bg-amber-50", title: "text-amber-800" },
  bad: { box: "border-rose-200 bg-rose-50", title: "text-rose-800" },
  info: { box: "border-sky-200 bg-sky-50", title: "text-sky-800" },
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      fill="currentColor"
    >
      <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
    </svg>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/**
 * One rule. Its name and plain description come from the RULES list, so search and the screen always agree.
 * Tap the title to open it; the "i" button explains it with an example.
 */
function Section({
  id,
  info,
  status,
  tone = "neutral",
  defaultOpen = false,
  children,
}: {
  id: string;
  info?: ReactNode;
  status?: string;
  tone?: StatusTone;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const rule = RULE_BY_ID[id];
  const bus = useContext(PageBusContext);
  const visible = bus.visibleIds.has(id);
  const [open, setOpen] = useState(defaultOpen);
  const [showInfo, setShowInfo] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bus.stamp > 0) setOpen(bus.open);
  }, [bus.stamp, bus.open]);

  // A search opens the rules it matches, so the answer is on screen straight away.
  useEffect(() => {
    if (bus.searching && visible) setOpen(true);
  }, [bus.searching, visible]);

  // A tile in "At a glance" opens the rule it points to, then scrolls it into view.
  useEffect(() => {
    if (bus.jumpStamp > 0 && bus.jumpId === id) {
      setOpen(true);
      const t = window.setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      return () => window.clearTimeout(t);
    }
  }, [bus.jumpStamp, bus.jumpId, id]);

  const panelId = `${id}-panel`;
  const st = STATUS_STYLES[tone];
  return (
    <div
      id={id}
      ref={ref}
      hidden={!visible}
      className={`scroll-mt-32 overflow-hidden rounded-2xl border bg-white shadow-sm transition-colors ${open ? "border-indigo-200" : "border-slate-200"}`}
    >
      <div className="flex items-start">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-h-16 min-w-0 flex-1 items-start gap-3 py-4 pl-4 pr-2 text-left transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-500 sm:pl-5"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold leading-snug text-slate-900">{rule.title}</span>
            <span className="mt-1 block text-[13px] leading-relaxed text-slate-500">{rule.hint}</span>
            {status && (
              <span className={`mt-2.5 inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${st.pill}`}>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${st.dot}`} aria-hidden="true" />
                <span className="min-w-0 break-words">{status}</span>
              </span>
            )}
          </span>
          <span
            aria-hidden="true"
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${open ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"}`}
          >
            <Chevron open={open} />
          </span>
        </button>
        {info && (
          <div className="shrink-0 pr-3 pt-4 sm:pr-4">
            <InfoButton
              label={rule.title}
              open={showInfo}
              onClick={() => {
                setOpen(true);
                setShowInfo((v) => !v);
              }}
            />
          </div>
        )}
      </div>
      {open && (
        <div id={panelId} className="border-t border-slate-100 bg-slate-50/60 px-4 pb-5 pt-4 sm:px-5">
          {info && showInfo && <InfoBox>{info}</InfoBox>}
          {children}
        </div>
      )}
    </div>
  );
}

/** A group of related rules. Hidden when the search matches none of them. */
function Category({ meta, children }: { meta: CategoryMeta; children: ReactNode }) {
  const bus = useContext(PageBusContext);
  const total = RULES.filter((r) => r.category === meta.key).length;
  const shown = RULES.filter((r) => r.category === meta.key && bus.visibleIds.has(r.id)).length;
  return (
    <section id={meta.anchor} hidden={shown === 0} aria-labelledby={`${meta.anchor}-title`} className="scroll-mt-32">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
          <Icon d={meta.icon} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${meta.anchor}-title`} className="text-base font-bold leading-tight text-slate-900">{meta.title}</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-slate-500">{meta.note}</p>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">
          {bus.searching ? `${shown} of ${total}` : `${total} ${total === 1 ? "rule" : "rules"}`}
        </span>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** Form fields laid out one per row on phones and side by side from small screens up. */
function Fields({ cols = 2, children }: { cols?: 1 | 2 | 3; children: ReactNode }) {
  const grid = cols === 3 ? "sm:grid-cols-3" : cols === 2 ? "sm:grid-cols-2" : "";
  return <div className={`grid grid-cols-1 gap-3 ${grid}`}>{children}</div>;
}

/** A divided block inside a rule, with its own small heading. */
function SubBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-5 border-t border-slate-200 pt-5">
      <h3 className="mb-3 text-[13px] font-bold text-slate-800">{title}</h3>
      {children}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-xs leading-relaxed text-slate-500">{children}</p>;
}

/** The plain-language result of the settings above, for an employee. */
function Example({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 rounded-xl border border-indigo-100 border-l-4 border-l-indigo-400 bg-indigo-50/70 px-3.5 py-3 text-[13px] leading-relaxed text-indigo-950">
      <span className="mb-1 block text-xs font-bold text-indigo-600">In practice</span>
      {children}
    </div>
  );
}

/** A number field. Shows the reason in red under it when the value is not allowed. */
function NumField({
  label,
  value,
  onChange,
  error,
  min,
  max,
  step = "1",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  min?: number;
  max?: number;
  step?: string;
}) {
  return (
    <div>
      <Input
        label={label}
        type="number"
        value={value}
        onChange={onChange}
        min={min === undefined ? undefined : String(min)}
        max={max === undefined ? undefined : String(max)}
        step={step}
        invalid={!!error}
      />
      {error && <p className="mt-1 text-xs font-semibold text-rose-600">{error}</p>}
    </div>
  );
}

/** The "i" button that reveals a rule's explanation. */
function InfoButton({ label, open, onClick }: { label: string; open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={`What does ${label} do?`}
      title="What does this do?"
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-extrabold italic transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${
        open ? "border-sky-600 bg-sky-600 text-white" : "border-sky-300 bg-white text-sky-700 hover:bg-sky-50"
      }`}
    >
      i
    </button>
  );
}

/** The explanation panel: how the rule works, then a worked example. */
function InfoBox({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4 space-y-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[13px] leading-relaxed text-sky-950 [&_b]:font-bold">
      {children}
    </div>
  );
}

function Toggle({ label, on, onToggle, info }: { label: string; on: boolean; onToggle: () => void; info?: ReactNode }) {
  const [showInfo, setShowInfo] = useState(false);
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={onToggle}
          className={`flex min-h-12 min-w-0 flex-1 items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-left text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
            on ? "border-indigo-300 bg-indigo-50 text-indigo-900" : "border-slate-300 bg-white text-slate-700"
          }`}
        >
          <span className="min-w-0 leading-snug">{label}</span>
          <span className="flex shrink-0 items-center gap-2">
            <span className={`text-xs font-bold ${on ? "text-indigo-700" : "text-slate-400"}`}>{on ? "On" : "Off"}</span>
            <span aria-hidden="true" className={`relative inline-block h-6 w-11 rounded-full transition-colors ${on ? "bg-indigo-600" : "bg-slate-300"}`}>
              <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`} />
            </span>
          </span>
        </button>
        {info && <InfoButton label={label} open={showInfo} onClick={() => setShowInfo((v) => !v)} />}
      </div>
      {info && showInfo && (
        <div className="mt-2">
          <InfoBox>{info}</InfoBox>
        </div>
      )}
    </div>
  );
}

/**
 * "i" explanations, one per rule. Each says what the rule does, when it applies, and what happens in a
 * practical example, so an admin knows the effect before turning it on or off.
 */
const INFO: Record<string, ReactNode> = {
  salaryBasis: (
    <>
      <p><b>How it works.</b> The daily rate is basic salary divided by a number of days. That daily rate is what one absent day, one half day, one unpaid leave day and one hour of overtime are worth. Pick the number that matches your payroll policy.</p>
      <p><b>Fixed 30-day month.</b> Always basic ÷ 30. Weekly offs count as paid days inside those 30.</p>
      <p><b>Working days only.</b> Basic ÷ the days in the cycle that are not weekly offs. Because the divisor is smaller, each day costs more.</p>
      <p><b>Calendar days.</b> Basic ÷ the actual days in the cycle, so a 31-day cycle has a smaller daily rate than a 28-day one.</p>
      <p><b>Example.</b> Basic ₹30,000 in a 31-day cycle with 4 Sundays off. Fixed 30 gives ₹1,000 a day. Working days (27) gives ₹1,111.11. Calendar days (31) gives ₹967.74. A 5% late deduction is ₹50, ₹55.56 or ₹48.39 respectively.</p>
    </>
  ),
  weeklyOff: (
    <>
      <p><b>How it works.</b> A weekly off is a day your company is closed every week. Nobody is marked absent on it, it is paid inside the 30-day salary month, and an employee who works on it earns a comp-off day. Any day that is not ticked is a normal working day, so a missing punch-in there is an absence.</p>
      <p><b>Example.</b> Only Sunday is ticked. Saturday is a working day, so an employee with no punch-in on a Saturday is absent. Tick Saturday too and it becomes a paid day off for everyone. With the working-days basis, both days are left out of the divisor.</p>
    </>
  ),
  paidHoliday: (
    <>
      <p><b>How it works.</b> A paid holiday is a one-off day off for the whole company, such as Diwali. It works like a weekly off: nobody is marked absent and nothing is deducted for that day, unless the Sunday &amp; holiday pay cut rule applies. You can add one for any day of a salary cycle, including a day that has already passed, while that cycle&apos;s salary is not finalized. The cycle&apos;s pay is recalculated straight away. Once a cycle is finalized, its holidays are locked.</p>
      <p><b>Example.</b> The office was closed on 12 November, so employees with no punch-in show as absent. Adding 12 November as a paid holiday removes that absence, and its deduction, for everyone, as long as the 26 Oct – 25 Nov salary is not finalized.</p>
    </>
  ),
  late: (
    <>
      <p><b>How it works.</b> The reference is each employee&apos;s own shift start. A punch-in inside the cool-off counts as on time. After the cool-off, and up to the half-day cut-off, the punch is <b>late</b>. After the cut-off it is a <b>half day</b>.</p>
      <p><b>Example.</b> Shift 09:00, cool-off 5 min, half day after 30 min late. Punch-in 09:04 is on time with full pay. 09:20 is late, so the late deduction applies. 09:45 is a half day, so the half-day deduction applies.</p>
    </>
  ),
  lateMarks: (
    <>
      <p><b>How it works.</b> Late days are counted within each salary cycle. Every N late days costs the penalty amount of salary, on top of the normal per-late deduction. Set N to 0 to turn this off.</p>
      <p><b>Example.</b> Every 3 late days, penalty 0.5 day. An employee who is late 6 times in one cycle loses 2 × 0.5 = 1 day&apos;s salary in addition to the normal late deductions.</p>
    </>
  ),
  earlyLeave: (
    <>
      <p><b>How it works.</b> Leaving is measured against the employee&apos;s own shift end. Leaving within the early-leave cool-off is fine. Leaving earlier is <b>early leave</b>. If a half-day limit is set and the employee leaves earlier than that, the day becomes a <b>half day</b>. The deduction is 0 by default.</p>
      <p><b>Example.</b> Shift ends 18:00, cool-off 5 min, half-day limit 120 min. Leaving at 17:56 is fine. 17:30 is early leave, and costs the deduction only if one is set. 15:30 is more than 2 hours early, so it is a half day.</p>
    </>
  ),
  halfDay: (
    <>
      <p><b>How it works.</b> A half day is a day the employee punched in after the half-day cut-off (see Late arrival), or left earlier than the early-leave half-day limit. It costs the half-day deduction set here, as a share of the daily rate. Unapproved absence is a separate rule, covered by Salary hold.</p>
      <p><b>Example.</b> Basic ₹30,000 on the fixed 30-day month gives a daily rate of ₹1,000. With a 50% half-day deduction, one half day costs ₹500.</p>
    </>
  ),
  salaryHold: (
    <>
      <p><b>How it works.</b> When this is on, each unapproved absence day (no punch and no approved leave) delays the employee&apos;s salary by the number of days set here. The delay is counted from the salary date, and the salary is not reduced. Consecutive unapproved days each count. An unapproved absence day is always unpaid, whatever this rule says.</p>
      <p><b>Example.</b> Salary date is the 5th. An employee has 2 unapproved days in the cycle, with a delay of 2 days per day. The delay is 4 days, so the full salary is paid on the 9th. Releasing that delay on the Salary page pays it on the 5th.</p>
    </>
  ),
  autoAbsent: (
    <>
      <p><b>How it works.</b> The shift length is measured from start to end. If an employee punches in after this percentage of the shift has already passed, the day is recorded as <b>Absent</b>, not late or half day. The employee can still punch in, and can still punch out. When the rule is off, the normal late and half-day rules apply.</p>
      <p><b>Example.</b> Shift 09:00–18:00 (9 hours) at 50%: the cut-off is 13:30. A punch-in at 13:20 follows the normal half-day rule. A punch-in at 13:45 is recorded as absent, with an unpaid day and no late or half-day deduction. At 60% the cut-off moves to 14:24.</p>
    </>
  ),
  overtime: (
    <>
      <p><b>How it works.</b> Time worked after shift end counts as overtime once the employee stays past shift end by the &quot;counts after&quot; minutes. Overtime is capped per day and paid at the chosen multiple of the hourly rate (daily rate ÷ shift hours). When it is off, the punch times are still recorded, but no overtime is paid.</p>
      <p><b>Example.</b> Shift ends 18:00, counts after 30 min, rate 1.5×, max 240 min. Leaving at 19:45 gives 105 minutes of overtime, paid as 1.75 hours × hourly rate × 1.5.</p>
    </>
  ),
  compOff: (
    <>
      <p><b>How it works.</b> Working a weekly off (Sunday by default) earns one comp-off day. In the same salary cycle, comp-off pays for an approved leave day, so that leave is not deducted. Comp-off that is not used by the last day of the cycle lapses, unless Extra pay is on.</p>
      <p><b>Example.</b> An employee works two Sundays and takes one leave in the same cycle. One Sunday pays for the leave, and the other lapses, or is paid if Extra pay is on.</p>
    </>
  ),
  extraPay: (
    <>
      <p><b>Off:</b> unused comp-off lapses with no pay. <b>On:</b> each unused comp-off day is paid at the set multiple of the daily rate when the cycle ends.</p>
      <p><b>Example.</b> Basic ₹30,000 on the fixed 30-day month gives a daily rate of ₹1,000. With a rate of 1×, one unused Sunday adds ₹1,000 to that month&apos;s pay.</p>
    </>
  ),
  holidayCut: (
    <>
      <p><b>How it works.</b> A block of consecutive non-working days (weekly offs and company holidays together) is cut by one day&apos;s pay when the working days directly before and after it include enough unauthorized absences. Approved leave never triggers the cut. Any punch inside the block cancels the cut.</p>
      <p><b>Example.</b> Sunday is a weekly off. The employee takes Saturday and Monday off without approval. With the trigger set to <b>2 days</b>, Sunday&apos;s pay is cut by one day. With <b>1 day</b>, a single unauthorized day next to the block is enough.</p>
    </>
  ),
  holidayCutToggle: (
    <>
      <p><b>Off:</b> Sunday and holiday pay is never cut. <b>On:</b> the trigger below applies to every weekly off and company holiday.</p>
      <p><b>Example.</b> A Friday holiday with unapproved leave on Thursday and Monday is cut by one day when the trigger is 2.</p>
    </>
  ),
  leaveDeduction: (
    <>
      <p><b>How it works.</b> Approved leave that is not covered by comp-off is deducted at this share of the daily rate. At 100% of the daily rate, it is unpaid. A fixed amount deducts that amount per day instead.</p>
      <p><b>Example.</b> Basic ₹30,000, daily rate ₹1,000, deduction 100%. One unpaid leave day deducts ₹1,000. If comp-off covers that day, nothing is deducted.</p>
    </>
  ),
  leaveAccrual: (
    <>
      <p><b>How it works.</b> Each employee earns 1 leave a month from their joining month, up to the annual limit. With <b>Carry forward</b>, unused leave adds up. With <b>Lapse monthly</b>, the leave earned this month must be used this month, or it is lost.</p>
      <p><b>Example.</b> An employee who joins on 15 November has 1 leave for November. With carry forward, the balance grows by 1 each month. With lapse, the November leave is lost on 30 November if it was not taken.</p>
    </>
  ),
  salaryCycle: (
    <>
      <p><b>How it works.</b> A cycle runs from its start day up to the day before the next one, and is named after the month it ends in. Its salary is paid on the <b>salary date</b>: the chosen day of the month after the cycle ends. Any salary-hold delay is added to that date.</p>
      <p><b>Example.</b> The cycle starts on day 26, so the &quot;Nov&quot; cycle runs 26 Oct to 25 Nov. With the salary date set to the 5th, it is paid on 5 Dec. Two unapproved days at 2 days each would move that to 9 Dec.</p>
    </>
  ),
  retention: (
    <>
      <p><b>How it works.</b> Punch photos are deleted 45 days after the work date. Attendance records without photos are kept for 90 days. Salary slips can be downloaded for 90 days after approval. Records for a cycle that has not been finalized are never deleted.</p>
      <p><b>Example.</b> A punch on 1 October keeps its photo until about 15 November. Its record (times and status, no photo) is deleted around 30 December, unless its salary cycle is still open.</p>
    </>
  ),
  midCycleSlip: (
    <>
      <p><b>Off (default):</b> an employee can request a salary slip only after the cycle is finalized. <b>On:</b> an employee can also request a slip for the cycle that is still running, for example when resigning mid-month.</p>
      <p><b>Example.</b> An employee resigns on 12 November, in the 26 Oct – 25 Nov cycle. With this on, they request the slip now. The admin approves it on 12 November, and the slip is marked <b>Provisional</b> with the figures up to that day. Once the cycle is finalized, the final figures replace it.</p>
    </>
  ),
};

export default function RulesPage() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.user.role === "company_admin";
  const currency = CURRENCY;

  const [form, setForm] = useState<Form | null>(null);
  const [savedStartDay, setSavedStartDay] = useState("1");
  const [snapshot, setSnapshot] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [finalizedPeriods, setFinalizedPeriods] = useState<{ start: string; end: string }[]>([]);
  const [hCycle, setHCycle] = useState(""); // YYYY-MM of the cycle being edited; empty = the current cycle
  const [hDate, setHDate] = useState("");
  const [hName, setHName] = useState("");
  const [hBusy, setHBusy] = useState(false);
  const [hError, setHError] = useState("");
  const [activeCat, setActiveCat] = useState<string>(CATEGORIES[0].anchor);
  const [query, setQuery] = useState("");
  const [reviewOpen, setReviewOpen] = useState(true);
  const [punchIn, setPunchIn] = useState("09:10");
  const [punchOut, setPunchOut] = useState("17:45");
  const [sample, setSample] = useState(DEFAULT_SAMPLE_SALARY);
  const [bus, setBus] = useState({ open: false, stamp: 0, jumpId: "", jumpStamp: 0 });

  const ready = !!form;
  const dirty = form ? JSON.stringify(form) !== snapshot : false;
  const problems = useMemo(() => (form ? validateRules(form) : []), [form]);
  const baseline = useMemo(() => (snapshot ? (JSON.parse(snapshot) as Form) : null), [snapshot]);
  const changes = useMemo(() => (form ? changesBetween(baseline, form) : []), [baseline, form]);
  const searching = query.trim() !== "";
  const visibleIds = useMemo(() => new Set(rulesMatching(query)), [query]);
  const busValue: PageBus = useMemo(() => ({ ...bus, searching, visibleIds }), [bus, searching, visibleIds]);

  // The current salary cycle, with the company's weekly offs and cycle start day as typed right now.
  // It drives the daily-rate comparison and the Test-a-day amounts, so both move as soon as a setting changes.
  const cycle = useMemo(() => {
    if (!form) return null;
    const sd = isValidStartDay(form.salaryCycleStartDay) ? num(form.salaryCycleStartDay) : 1;
    const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
    const key = currentCycleKey(today, sd);
    const period = cyclePeriod(key.year, key.month, sd);
    const off = new Set(parseOffDays(form.weeklyOff));
    let days = 0;
    let weeklyOffDays = 0;
    for (let t = period.start.getTime(); t <= period.end.getTime(); t += 86400000) {
      days++;
      if (off.has(new Date(t).getUTCDay())) weeklyOffDays++;
    }
    const divisors: Record<SalaryBasis, number> = {
      fixed: dailyRateDivisor("fixed", period, off),
      working: dailyRateDivisor("working", period, off),
      calendar: dailyRateDivisor("calendar", period, off),
    };
    return {
      label: `${formatDayKey(dateKey(period.start))} – ${formatDayKey(dateKey(period.end))}`,
      days,
      weeklyOffDays,
      divisors,
    };
  }, [form]);

  const sampleSalary = num(sample);
  const rateFor = (basis: SalaryBasis) => (cycle && sampleSalary > 0 ? sampleSalary / cycle.divisors[basis] : 0);
  const activeBasis: SalaryBasis = form ? salaryBasisOf(form.dailyRateBasis) : "fixed";
  const activeRate = rateFor(activeBasis);

  // The success note disappears on its own, or as soon as something is edited again.
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => setMessage(""), 6000);
    return () => window.clearTimeout(t);
  }, [message]);
  useEffect(() => {
    if (dirty) setMessage("");
  }, [dirty]);

  // Errors show at the top of the page, so bring them into view.
  useEffect(() => {
    if (error) window.scrollTo({ top: 0, behavior: "smooth" });
  }, [error]);

  // Warn before the browser tab closes or reloads while there are unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Highlight the group chip for the part of the page being read. Hidden groups are skipped.
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      let current: string | null = null;
      for (const c of CATEGORIES) {
        const el = document.getElementById(c.anchor);
        if (!el || el.hidden) continue;
        if (current === null) current = c.anchor;
        if (el.getBoundingClientRect().top <= 170) current = c.anchor;
      }
      if (current) setActiveCat(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ready, query]);
  useEffect(() => {
    document.getElementById(`chip-${activeCat}`)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [activeCat]);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const data = await api<{ settings: Record<string, unknown> | null; holidays?: Holiday[]; finalizedPeriods?: { start: string; end: string }[] }>("/api/settings");
      const s = data.settings;
      if (!s) throw new Error("Company settings are not available.");
      const f: Record<string, string> = {};
      for (const k of FIELDS) f[k] = String(s[k] ?? "");
      const next: Form = {
        ...(f as Form),
        overtimeEnabled: !!s.overtimeEnabled,
        extraPayEnabled: !!s.extraPayEnabled,
        holidayDeductionEnabled: !!s.holidayDeductionEnabled,
        absentAfterPercentEnabled: !!s.absentAfterPercentEnabled,
        midCycleSlipEnabled: !!s.midCycleSlipEnabled,
        salaryHoldEnabled: s.salaryHoldEnabled !== false,
        leaveAccrualMode: s.leaveAccrualMode === "lapse" ? "lapse" : "carry",
        weeklyOff: parseOffDays(String(s.weeklyOff ?? "0")).join(","),
        dailyRateBasis: salaryBasisOf(s.dailyRateBasis),
      };
      setHolidays(data.holidays ?? []);
      setFinalizedPeriods(data.finalizedPeriods ?? []);
      setForm(next);
      setSnapshot(JSON.stringify(next));
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
  const expandAll = (open: boolean) => setBus((b) => ({ ...b, open, stamp: b.stamp + 1 }));
  /** Opens one rule and clears the search, so the rule is always visible when it is reached. */
  const jumpTo = (id: string) => {
    setQuery("");
    setBus((b) => ({ ...b, jumpId: id, jumpStamp: b.jumpStamp + 1 }));
  };

  // Paid holidays save the moment they are added, so they never touch the unsaved rule edits on this page.
  const refreshHolidays = async () => {
    const data = await api<{ holidays?: Holiday[]; finalizedPeriods?: { start: string; end: string }[] }>("/api/settings");
    setHolidays(data.holidays ?? []);
    setFinalizedPeriods(data.finalizedPeriods ?? []);
  };

  const addHoliday = async (cycleStart: string, cycleEnd: string) => {
    setHError("");
    if (!hDate || !hName.trim()) return;
    if (hDate < cycleStart || hDate > cycleEnd) {
      setHError(`Pick a date inside this cycle (${formatDayKey(cycleStart)} to ${formatDayKey(cycleEnd)}).`);
      return;
    }
    setHBusy(true);
    try {
      await api("/api/settings", { method: "POST", body: JSON.stringify({ holiday: { date: hDate, name: hName.trim() } }) });
      setHDate("");
      setHName("");
      await refreshHolidays();
      setMessage("Paid holiday added. Attendance and pay for that day are updated.");
    } catch (e) {
      setHError(e instanceof Error ? e.message : "Could not add the holiday");
    } finally {
      setHBusy(false);
    }
  };

  const removeHoliday = async (h: Holiday) => {
    if (!window.confirm(`Remove the paid holiday "${h.name}" on ${formatDayKey(h.holidayDate.slice(0, 10))}? That day will count as a normal working day again.`)) return;
    setHError("");
    setHBusy(true);
    try {
      await api("/api/settings", { method: "POST", body: JSON.stringify({ deleteHolidayId: h.id }) });
      await refreshHolidays();
      setMessage("Holiday removed.");
    } catch (e) {
      setHError(e instanceof Error ? e.message : "Could not remove the holiday");
    } finally {
      setHBusy(false);
    }
  };

  const save = async () => {
    if (!form) return;
    if (problems.length > 0) {
      setError(
        `Fix the ${problems.length} highlighted ${problems.length === 1 ? "setting" : "settings"} before saving. Open Review changes to see ${problems.length === 1 ? "it" : "them"}.`
      );
      setReviewOpen(true);
      return;
    }
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const settings: Record<string, unknown> = {
        weeklyOff: parseOffDays(form.weeklyOff).join(","),
        dailyRateBasis: form.dailyRateBasis,
        overtimeEnabled: form.overtimeEnabled,
        extraPayEnabled: form.extraPayEnabled,
        holidayDeductionEnabled: form.holidayDeductionEnabled,
        absentAfterPercentEnabled: form.absentAfterPercentEnabled,
        midCycleSlipEnabled: form.midCycleSlipEnabled,
        leaveAccrualMode: form.leaveAccrualMode,
        salaryHoldEnabled: form.salaryHoldEnabled,
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

  // Ctrl+S (⌘S on a Mac) saves. The ref keeps the listener pointing at the latest save.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready]);

  const discard = () => {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    void load();
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
    const autoPct = Math.min(100, Math.max(10, num(form.absentAfterPercent) || 50));
    return {
      autoPct,
      absentCut: toTime(start + ((end - start) * autoPct) / 100),
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
      salaryDate: dateKey(salaryDateOf(key.year, key.month, num(form.salaryDisbursementDay) || 5)),
    };
  }, [form]);

  if (meLoading || (loading && isAdmin)) return <div className="flex justify-center py-16"><Spinner /></div>;
  if (!isAdmin) return <EmptyState message="Only company admins can manage rules." />;
  if (!form || !example || !cycle) {
    return (
      <div>
        <PageHeader title="Rules" subtitle="How attendance, pay and deductions are worked out" />
        <ErrorBanner message={loadError || "Rules are not available."} onRetry={load} />
      </div>
    );
  }

  const problemFor = (field: string) => problems.find((p) => p.field === field)?.message;
  // A worked example is only shown once the numbers it uses are valid, so it never reads as nonsense.
  const lateExampleOk = !problemFor("graceMinutes") && !problemFor("lateThresholdMinutes");
  const earlyExampleOk = !problemFor("earlyLeaveGraceMinutes") && !problemFor("earlyLeaveHalfDayMinutes");
  const previewLines = previewDay(form, punchIn, punchOut, activeRate > 0 ? activeRate : undefined);

  // ---- weekly offs and paid holidays (these use the SAVED cycle start day, not one that is still being typed)
  const offDays = parseOffDays(form.weeklyOff);
  const offNames = offDays.length ? offDays.map((n) => WEEKDAYS[n].long).join(", ") : "None";
  const savedSd = Math.min(28, Math.max(1, Math.round(Number(savedStartDay)) || 1));
  const todayUtc = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const todayKey = dateKey(todayUtc);
  const nowCycle = currentCycleKey(todayUtc, savedSd);
  const nowCycleKey = `${nowCycle.year}-${String(nowCycle.month).padStart(2, "0")}`;
  const selCycleKey = hCycle || nowCycleKey;
  const [selYear, selMonth] = selCycleKey.split("-").map(Number);
  const selPeriod = cyclePeriod(selYear, selMonth, savedSd);
  const selStart = dateKey(selPeriod.start);
  const selEnd = dateKey(selPeriod.end);
  const nowPeriod = cyclePeriod(nowCycle.year, nowCycle.month, savedSd);
  const inRange = (h: Holiday, a: string, b: string) => {
    const d = h.holidayDate.slice(0, 10);
    return d >= a && d <= b;
  };
  const cycleHolidays = holidays.filter((h) => inRange(h, selStart, selEnd));
  const nowCycleHolidayCount = holidays.filter((h) => inRange(h, dateKey(nowPeriod.start), dateKey(nowPeriod.end))).length;
  const selLocked = finalizedPeriods.some((p) => p.start <= selEnd && p.end >= selStart);
  const toggleOffDay = (n: number) => {
    const cur = new Set(offDays);
    if (cur.has(n)) cur.delete(n);
    else {
      if (cur.size >= 6) return; // at least one day of the week must stay a working day
      cur.add(n);
    }
    set({ weeklyOff: [...cur].sort((a, b) => a - b).join(",") });
  };

  const goToCategory = (anchor: string) => {
    setActiveCat(anchor);
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const basisShort: Record<SalaryBasis, string> = {
    fixed: "÷ 30 every month",
    working: `÷ ${cycle.divisors.working} working days`,
    calendar: `÷ ${cycle.divisors.calendar} calendar days`,
  };
  const lateDedText = form.lateDeductionType === "fixed" ? money(num(form.lateDeductionValue)) : `${num(form.lateDeductionValue)}% of a day`;
  const halfDedText = form.halfDayDeductionType === "fixed" ? money(num(form.halfDayDeductionValue)) : `${num(form.halfDayDeductionValue)}% of a day`;

  // Plain-language summary: how pay works for this company, in one sentence per topic.
  const summary: string[] = [
    sampleSalary > 0
      ? `One day of pay is basic salary ÷ ${cycle.divisors[activeBasis]} (${basisLabel(activeBasis).replace("Basic ÷ ", "")}). For ${money(sampleSalary)} basic in this cycle, a day is worth ${money(Math.round(activeRate * 100) / 100)}.`
      : `One day of pay is basic salary ÷ ${cycle.divisors[activeBasis]} (${basisLabel(activeBasis).replace("Basic ÷ ", "")}).`,
    `Arriving up to ${num(form.graceMinutes)} minutes after shift start is on time. Up to ${num(form.lateThresholdMinutes)} minutes late is a late day (${lateDedText} deducted); later is a half day (${halfDedText} deducted).`,
    form.absentAfterPercentEnabled
      ? `Punching in after ${num(form.absentAfterPercent)}% of the shift counts as absent, not late.`
      : "Late and half-day rules apply however late the punch-in is.",
    form.overtimeEnabled
      ? `Overtime is paid at ${num(form.overtimeRate)}× after ${num(form.overtimeMinMinutes)} minutes past shift end, up to ${num(form.overtimeMaxMinutesPerDay)} minutes a day.`
      : "Overtime is not paid. Punch times are still recorded.",
    offDays.length
      ? `Weekly off: ${offNames}. Working on one earns a comp-off day${form.extraPayEnabled ? ", and unused comp-off is paid" : ", which lapses if not used in the same cycle"}.`
      : "No weekly off is set, so every day is a working day.",
    form.salaryHoldEnabled
      ? `Each unapproved absence day delays the salary by ${num(form.unapprovedHoldDays)} days. The amount is not reduced.`
      : "Unapproved absence is unpaid, and does not delay the salary.",
    example.sd === 1
      ? `Salary covers each calendar month, and is paid on the ${ordinal(num(form.salaryDisbursementDay) || 5)} of the month after.`
      : `Salary covers the ${ordinal(example.sd)} to the ${ordinal(example.sd - 1)} of each month, and is paid on the ${ordinal(num(form.salaryDisbursementDay) || 5)} of the month after.`,
  ];

  const glance = [
    { id: "rule-salary-basis", label: "Daily rate", value: basisShort[activeBasis], on: true },
    { id: "rule-salary-hold", label: "Salary hold", value: form.salaryHoldEnabled ? `${num(form.unapprovedHoldDays)} days per unapproved day` : "Off", on: form.salaryHoldEnabled },
    { id: "rule-salary-cycle", label: "Salary date", value: `${ordinal(num(form.salaryDisbursementDay) || 5)} of next month`, on: true },
    { id: "rule-late", label: "Late rule", value: `${num(form.graceMinutes)} min cool-off, half day after ${num(form.lateThresholdMinutes)} min late`, on: true },
    { id: "rule-auto-absent", label: "Auto-absent", value: form.absentAfterPercentEnabled ? `After ${num(form.absentAfterPercent)}% of shift` : "Off", on: form.absentAfterPercentEnabled },
    { id: "rule-overtime", label: "Overtime", value: form.overtimeEnabled ? `${num(form.overtimeRate)}× pay` : "Off", on: form.overtimeEnabled },
    { id: "rule-weekly-off", label: "Weekly off", value: offDays.length ? offDays.map((n) => WEEKDAYS[n].short).join(", ") : "None", on: offDays.length > 0 },
    { id: "rule-paid-holidays", label: "Paid holidays", value: nowCycleHolidayCount > 0 ? `${nowCycleHolidayCount} this cycle` : "None this cycle", on: nowCycleHolidayCount > 0 },
  ];

  const errorCount = problems.length;

  return (
    <PageBusContext.Provider value={busValue}>
      <div className={dirty ? "pb-40 lg:pb-32" : ""}>
        <PageHeader
          title="Rules"
          subtitle="How attendance, pay and deductions are worked out for your company"
          action={
            <Button size="sm" onClick={save} loading={saving} disabled={errorCount > 0}>
              Save rules
            </Button>
          }
        />

        {error && <ErrorBanner message={error} />}

        {/* Plain-language summary of how pay works, updated as you type */}
        <Card className="mb-4 p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <h2 className="text-sm font-bold text-slate-900">How pay works for your company</h2>
            <span className="text-xs text-slate-500">Updates as you change the rules</span>
          </div>
          <ul className="space-y-2.5">
            {summary.map((line) => (
              <li key={line} className="flex gap-2.5 text-[13px] leading-relaxed text-slate-700">
                <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                <span className="min-w-0">{line}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            Current cycle: {cycle.label}, {cycle.days} calendar days, {cycle.weeklyOffDays} weekly off{cycle.weeklyOffDays === 1 ? "" : "s"}, {cycle.divisors.working} working days.
          </p>
        </Card>

        {/* How-to: the three things an admin does on this page */}
        <Card className="mb-4 p-4 sm:p-5">
          <h2 className="text-sm font-bold text-slate-900">How to use this page</h2>
          <ol className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              { t: "Find a rule", d: "Search, pick a group, or tap a tile under At a glance." },
              { t: "Read it", d: "Tap a rule's title to open it. The blue i button explains it with an example." },
              { t: "Change and save", d: "Edit the rule, check it under Test a day, then press Save rules." },
            ].map((s, i) => (
              <li key={s.t} className="flex gap-3 rounded-xl bg-slate-50 p-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">{s.t}</span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-slate-500">{s.d}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Changes apply to new punches and to salary cycles that are not finalized yet. A finalized cycle is never changed. Press Ctrl+S (⌘S on a Mac) to save quickly.
          </p>
        </Card>

        {/* Review panel: what will change, and what must be fixed before saving */}
        {dirty && (
          <div id="rules-review" className="mb-4 scroll-mt-32 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900">
                {errorCount > 0 ? "Fix these before saving" : "Review your changes"}
              </h2>
              <button
                type="button"
                onClick={() => setReviewOpen((o) => !o)}
                aria-expanded={reviewOpen}
                className="text-xs font-semibold text-indigo-700 hover:underline"
              >
                {reviewOpen ? "Hide" : "Show"}
              </button>
            </div>
            {reviewOpen && (
              <div className="mt-3 space-y-4">
                {errorCount > 0 && (
                  <ul className="space-y-2">
                    {problems.map((p) => (
                      <li key={p.field}>
                        <button
                          type="button"
                          onClick={() => jumpTo(p.ruleId)}
                          className="flex w-full flex-wrap items-baseline gap-x-2 rounded-xl bg-white px-3.5 py-2.5 text-left text-[13px] ring-1 ring-rose-200 hover:bg-rose-50"
                        >
                          <span className="font-semibold text-rose-700">{RULE_BY_ID[p.ruleId].title}:</span>
                          <span className="text-rose-700">{p.message}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {changes.length > 0 ? (
                  <ul className="divide-y divide-amber-200/70 overflow-hidden rounded-xl bg-white ring-1 ring-amber-200">
                    {changes.map((c) => (
                      <li key={c.key} className="px-3.5 py-2.5 text-[13px]">
                        <p className="font-semibold text-slate-900">{c.label}</p>
                        <p className="mt-0.5 text-slate-600">
                          <span className="line-through decoration-slate-400">{c.from}</span>{" "}
                          <span aria-hidden="true">→</span>{" "}
                          <span className="font-semibold text-slate-900">{c.to}</span>
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-slate-600">
                    These edits are to switched-off rules, so they do not change how any day is paid today.
                  </p>
                )}
                <p className="text-xs text-slate-500">Nothing changes until you press Save rules.</p>
              </div>
            )}
          </div>
        )}

        {/* At a glance: the settings that matter most. Tapping one opens that rule. */}
        <Card className="mb-4 p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <h2 className="text-sm font-bold text-slate-900">At a glance</h2>
            <span className="text-xs text-slate-500">Tap a tile to open that rule</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {glance.map((g) => (
              <button
                key={g.label}
                type="button"
                onClick={() => jumpTo(g.id)}
                className="group min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
              >
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${g.on ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden="true" />
                  {g.label}
                </span>
                <span className={`mt-1 block text-sm font-bold leading-snug ${g.on ? "text-slate-900" : "text-slate-400"}`}>{g.value}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* Test a day: see what the rules on this page would do, in time and in rupees, before saving */}
        <Card className="mb-4 p-4 sm:p-5">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <h2 className="text-sm font-bold text-slate-900">Test a day</h2>
            <span className="text-xs text-slate-500">
              Shift {form.shiftStart}–{form.shiftEnd}
            </span>
          </div>
          <p className="mb-3 text-[13px] leading-relaxed text-slate-500">
            Type one day&apos;s punches and a sample salary to see how these rules would count it, including changes you have not saved yet. The sample salary is not saved. The shift is set on the Settings page.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input label="Punch in" type="time" value={punchIn} onChange={setPunchIn} />
            <Input label="Punch out (optional)" type="time" value={punchOut} onChange={setPunchOut} />
            <Input label={`Sample basic salary (${currency})`} type="number" value={sample} onChange={setSample} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {sampleSalary > 0 ? (
              <>A day of pay is <b className="text-slate-700">{money(Math.round(activeRate * 100) / 100)}</b> on the basis you have chosen, for this cycle.</>
            ) : (
              "Enter a sample basic salary to see rupee amounts."
            )}
          </p>
          <div className="mt-4 space-y-2" aria-live="polite">
            {previewLines.length === 0 ? (
              <p className="text-[13px] text-slate-500">Enter a punch-in time to see the result.</p>
            ) : (
              previewLines.map((l) => (
                <div key={l.title} className={`rounded-xl border px-3.5 py-2.5 ${PREVIEW_STYLES[l.tone].box}`}>
                  <p className={`text-sm font-bold ${PREVIEW_STYLES[l.tone].title}`}>{l.title}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-slate-700">{l.detail}</p>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Search and expand controls */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 basis-64">
            <label htmlFor="rules-search" className="sr-only">Search rules</label>
            <input
              id="rules-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
              }}
              placeholder="Search rules, e.g. late, overtime, salary date, daily rate"
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <Button size="sm" variant="secondary" onClick={() => expandAll(true)}>Expand all</Button>
          <Button size="sm" variant="secondary" onClick={() => expandAll(false)}>Collapse all</Button>
        </div>
        {searching && (
          <p className="mb-3 text-[13px] text-slate-500">
            {visibleIds.size === 0
              ? "No rules match"
              : `${visibleIds.size} ${visibleIds.size === 1 ? "rule matches" : "rules match"}`}{" "}
            &ldquo;{query.trim()}&rdquo;.{" "}
            <button type="button" onClick={() => setQuery("")} className="font-semibold text-indigo-600 hover:underline">
              Clear search
            </button>
          </p>
        )}

        {/* Group bar: sticks under the top bar while scrolling and follows the part being read */}
        <nav
          aria-label="Rule groups"
          className="sticky top-[3.75rem] z-20 -mx-4 mb-3 bg-slate-100/95 px-4 py-2 backdrop-blur lg:top-0 lg:mx-0 lg:px-0"
        >
          <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {CATEGORIES.map((c) => {
              const active = activeCat === c.anchor;
              const count = RULES.filter((r) => r.category === c.key && visibleIds.has(r.id)).length;
              return (
                <a
                  key={c.key}
                  id={`chip-${c.anchor}`}
                  href={`#${c.anchor}`}
                  aria-current={active ? "true" : undefined}
                  aria-disabled={count === 0 ? "true" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    if (count > 0) goToCategory(c.anchor);
                  }}
                  className={`shrink-0 rounded-full border px-4 py-2 text-[13px] font-semibold transition-colors ${
                    count === 0
                      ? "border-slate-200 bg-white text-slate-400"
                      : active
                        ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-700"
                  }`}
                >
                  {c.chip}
                </a>
              );
            })}
          </div>
        </nav>

        {searching && visibleIds.size === 0 && (
          <Card className="mb-4 p-6 text-center">
            <p className="text-sm font-semibold text-slate-900">Nothing matches that search.</p>
            <p className="mt-1 text-[13px] text-slate-500">Try a shorter word, such as late, leave, overtime or salary.</p>
            <Button className="mt-4" size="sm" variant="secondary" onClick={() => setQuery("")}>Clear search</Button>
          </Card>
        )}

        <div className="space-y-10">
          {/* ---------------------------------------------------------- Working hours */}
          <Category meta={CATEGORIES[0]}>
            <Section id="rule-late" defaultOpen info={INFO.late} status={`${num(form.graceMinutes)} min cool-off`}>
              <Fields>
                <NumField label="Cool-off time (minutes)" value={form.graceMinutes} onChange={(v) => set({ graceMinutes: v })} error={problemFor("graceMinutes")} min={0} max={120} />
                <NumField label="Half-day after (minutes late)" value={form.lateThresholdMinutes} onChange={(v) => set({ lateThresholdMinutes: v })} error={problemFor("lateThresholdMinutes")} min={0} max={720} />
                <Select label="Late deduction type" value={form.lateDeductionType} onChange={(v) => set({ lateDeductionType: v })} options={DEDUCTION_TYPES} />
                <NumField
                  label={form.lateDeductionType === "fixed" ? `Late deduction (${currency})` : "Late deduction (% of a day)"}
                  value={form.lateDeductionValue}
                  onChange={(v) => set({ lateDeductionValue: v })}
                  error={problemFor("lateDeductionValue")}
                  min={0}
                  max={form.lateDeductionType === "fixed" ? undefined : 100}
                />
              </Fields>
              {lateExampleOk ? (
                <Example>
                  For a <b>{example.start}</b> shift with a <b>{num(form.graceMinutes)}-minute</b> cool-off: punching in up to <b>{example.onTimeUntil}</b> still
                  gets the <b>full day</b> (no deduction). <b>{example.lateFrom}–{example.lateUntil}</b> is marked <b>late</b>. After <b>{example.halfAfter}</b> it
                  becomes a <b>half day</b>. Each employee&apos;s own punch-in time is used, so a 14:00 shift gets the same cool-off from 14:00.
                </Example>
              ) : (
                <Note>Fix the highlighted values to see the example.</Note>
              )}
            </Section>

            <Section id="rule-auto-absent" info={INFO.autoAbsent} tone={form.absentAfterPercentEnabled ? "on" : "off"} status={form.absentAfterPercentEnabled ? `Absent after ${num(form.absentAfterPercent)}%` : "Off"}>
              <Toggle
                info={INFO.autoAbsent}
                label="Mark absent when punching in after a set share of the shift"
                on={form.absentAfterPercentEnabled}
                onToggle={() => set({ absentAfterPercentEnabled: !form.absentAfterPercentEnabled })}
              />
              {form.absentAfterPercentEnabled ? (
                <>
                  <Fields>
                    <NumField label="Share of the shift that has passed (10–100 %)" value={form.absentAfterPercent} onChange={(v) => set({ absentAfterPercent: v })} error={problemFor("absentAfterPercent")} min={10} max={100} />
                  </Fields>
                  <Example>
                    For a <b>{example.start}–{example.end}</b> shift at <b>{example.autoPct}%</b>, punching in after <b>{example.absentCut}</b> is recorded as{" "}
                    <b>absent</b>. The employee can still punch in and out, and the day is unpaid like any other absence. Punch-ins before that time follow the late and half-day rules above.
                  </Example>
                </>
              ) : (
                <Note>Off. Late and half-day rules apply however late the punch-in is.</Note>
              )}
            </Section>

            <Section id="rule-early-leave" info={INFO.earlyLeave} status={`${num(form.earlyLeaveGraceMinutes)} min cool-off`}>
              <Fields>
                <NumField label="Early-leave cool-off (minutes)" value={form.earlyLeaveGraceMinutes} onChange={(v) => set({ earlyLeaveGraceMinutes: v })} error={problemFor("earlyLeaveGraceMinutes")} min={0} max={120} />
                <NumField label="Half day if earlier than (minutes, 0 = off)" value={form.earlyLeaveHalfDayMinutes} onChange={(v) => set({ earlyLeaveHalfDayMinutes: v })} error={problemFor("earlyLeaveHalfDayMinutes")} min={0} max={720} />
                <Select label="Early-leave deduction type" value={form.earlyLeaveDeductionType} onChange={(v) => set({ earlyLeaveDeductionType: v })} options={DEDUCTION_TYPES} />
                <NumField
                  label={form.earlyLeaveDeductionType === "fixed" ? `Deduction per day (${currency})` : "Deduction per day (% of a day)"}
                  value={form.earlyLeaveDeductionValue}
                  onChange={(v) => set({ earlyLeaveDeductionValue: v })}
                  error={problemFor("earlyLeaveDeductionValue")}
                  min={0}
                  max={form.earlyLeaveDeductionType === "fixed" ? undefined : 100}
                />
              </Fields>
              {earlyExampleOk ? (
                <Example>
                  For a shift ending at <b>{example.end}</b>: leaving from <b>{example.earlyOkFrom}</b> onward is fine.
                  Leaving earlier counts as <b>early leave</b>
                  {example.eHalf > 0 ? <>, and leaving before <b>{example.earlyHalfBefore}</b> becomes a <b>half day</b></> : null}.
                  The deduction is <b>0 by default</b>, so set an amount if you want early leave to cost salary.
                </Example>
              ) : (
                <Note>Fix the highlighted values to see the example.</Note>
              )}
            </Section>

            <Section id="rule-late-marks" info={INFO.lateMarks} tone={num(form.lateMarksLimit) > 0 ? "on" : "off"} status={num(form.lateMarksLimit) > 0 ? `Every ${num(form.lateMarksLimit)} late days` : "Off"}>
              <Fields>
                <NumField label="Every … late days (0 = off)" value={form.lateMarksLimit} onChange={(v) => set({ lateMarksLimit: v })} error={problemFor("lateMarksLimit")} min={0} max={31} />
                <NumField label="… cost this many days of salary" value={form.lateMarksPenaltyDays} onChange={(v) => set({ lateMarksPenaltyDays: v })} error={problemFor("lateMarksPenaltyDays")} min={0} max={5} step="0.25" />
              </Fields>
              {num(form.lateMarksLimit) > 0 ? (
                <Example>Every <b>{num(form.lateMarksLimit)}</b> late days in a cycle deduct <b>{num(form.lateMarksPenaltyDays)}</b> day(s) of salary.</Example>
              ) : (
                <Note>Off. Late days only cost the normal per-late deduction.</Note>
              )}
            </Section>
          </Category>

          {/* ---------------------------------------------------------- Daily pay */}
          <Category meta={CATEGORIES[1]}>
            <Section id="rule-salary-basis" info={INFO.salaryBasis} tone="on" status={`${basisLabel(activeBasis).replace("Basic ", "")} · ${money(Math.round(activeRate * 100) / 100)} a day`}>
              <div role="radiogroup" aria-label="Daily rate basis" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {SALARY_BASIS_OPTIONS.map((o) => {
                  const selected = activeBasis === o.value;
                  const rate = rateFor(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => set({ dailyRateBasis: o.value })}
                      className={`flex min-h-full flex-col gap-2 rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
                        selected ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <span className="flex items-start gap-2.5">
                        <span
                          aria-hidden="true"
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-indigo-600" : "border-slate-300"}`}
                        >
                          {selected && <span className="h-2.5 w-2.5 rounded-full bg-indigo-600" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-bold text-slate-900">{o.title}</span>
                          <span className="mt-0.5 block text-[13px] leading-snug text-slate-500">{o.text}</span>
                        </span>
                      </span>
                      <span className="mt-auto flex items-baseline justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-slate-200">
                        <span className="text-xs font-medium text-slate-500">÷ {cycle.divisors[o.value]}</span>
                        <span className="text-sm font-bold text-slate-900">{sampleSalary > 0 ? `${money(Math.round(rate * 100) / 100)} a day` : "–"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3.5">
                <p className="text-xs font-semibold text-slate-600">
                  Live check for the current cycle ({cycle.label}): {cycle.days} calendar days, {cycle.weeklyOffDays} weekly off{cycle.weeklyOffDays === 1 ? "" : "s"}, {cycle.divisors.working} working days.
                </p>
                <div className="mt-3 max-w-xs">
                  <NumField label={`Sample basic salary (${currency}), for this check only`} value={sample} onChange={setSample} min={0} />
                </div>
                <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-left text-[13px]">
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Basis</th>
                        <th className="px-3 py-2 text-right font-semibold">Divided by</th>
                        <th className="px-3 py-2 text-right font-semibold">One day</th>
                        <th className="px-3 py-2 text-right font-semibold">5% late deduction</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {SALARY_BASIS_OPTIONS.map((o) => {
                        const rate = rateFor(o.value);
                        const selected = activeBasis === o.value;
                        return (
                          <tr key={o.value} className={selected ? "bg-indigo-50/60 font-semibold text-slate-900" : "text-slate-700"}>
                            <td className="px-3 py-2">
                              {o.title}
                              {selected && <span className="ml-1.5 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">In use</span>}
                            </td>
                            <td className="px-3 py-2 text-right">{cycle.divisors[o.value]}</td>
                            <td className="px-3 py-2 text-right">{sampleSalary > 0 ? money(Math.round(rate * 100) / 100) : "–"}</td>
                            <td className="px-3 py-2 text-right">{sampleSalary > 0 ? money(Math.round(rate * 5) / 100) : "–"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <Example>
                With <b>{money(sampleSalary || 0)}</b> basic, one absent day costs <b>{sampleSalary > 0 ? money(Math.round(activeRate * 100) / 100) : "–"}</b> on the basis in use.
                {activeBasis === "working"
                  ? " Weekly offs are left out of the divisor, so every working day is worth more than on the 30-day month."
                  : activeBasis === "calendar"
                    ? " The daily rate moves with the number of days in each cycle, so a 28-day cycle pays more per day than a 31-day cycle."
                    : " The daily rate is the same in every month, whatever the calendar."}
              </Example>
              <Note>
                Paid holidays still count as working days. Weekly offs are the only days left out. Changing the basis applies to salary cycles that are not finalized yet. A finalized month keeps the daily rate it was worked out with.
              </Note>
            </Section>

            <Section id="rule-half-day" info={INFO.halfDay} status={`${halfDedText} of a day`}>
              <Fields>
                <Select label="Half-day deduction type" value={form.halfDayDeductionType} onChange={(v) => set({ halfDayDeductionType: v })} options={DEDUCTION_TYPES} />
                <NumField
                  label={form.halfDayDeductionType === "fixed" ? `Half-day deduction (${currency})` : "Half-day deduction (% of a day)"}
                  value={form.halfDayDeductionValue}
                  onChange={(v) => set({ halfDayDeductionValue: v })}
                  error={problemFor("halfDayDeductionValue")}
                  min={0}
                  max={form.halfDayDeductionType === "fixed" ? undefined : 100}
                />
              </Fields>
              <Example>
                {sampleSalary > 0 ? (
                  <>A half day costs <b>{form.halfDayDeductionType === "fixed" ? money(num(form.halfDayDeductionValue)) : money(Math.round(activeRate * num(form.halfDayDeductionValue)) / 100)}</b> on the basis in use, for the sample salary above.</>
                ) : (
                  <>Enter a sample basic salary in Daily rate to see the rupee amount.</>
                )}
              </Example>
              <Note>Unapproved absence is a separate rule. See Salary hold for unapproved absence, below.</Note>
            </Section>

            <Section id="rule-leave-deduction" info={INFO.leaveDeduction} status={form.leaveDeductionType === "fixed" ? `${currency}${num(form.leaveDeductionValue)} per day` : `${num(form.leaveDeductionValue)}% of a day`}>
              <Fields>
                <Select label="Approved-leave deduction type" value={form.leaveDeductionType} onChange={(v) => set({ leaveDeductionType: v })} options={DEDUCTION_TYPES} />
                <NumField
                  label={form.leaveDeductionType === "fixed" ? `Leave deduction (${currency})` : "Leave deduction (% of a day)"}
                  value={form.leaveDeductionValue}
                  onChange={(v) => set({ leaveDeductionValue: v })}
                  error={problemFor("leaveDeductionValue")}
                  min={0}
                  max={form.leaveDeductionType === "fixed" ? undefined : 100}
                />
              </Fields>
              <Note>Approved leave is deducted at the rate above, but only the days not covered by comp-off (see Overtime, comp-off &amp; holiday cuts).</Note>
            </Section>

            <Section id="rule-salary-hold" info={INFO.salaryHold} tone={form.salaryHoldEnabled ? "on" : "off"} status={form.salaryHoldEnabled ? `${num(form.unapprovedHoldDays)} days per unapproved day` : "Off"}>
              <Toggle
                info={INFO.salaryHold}
                label="Unapproved days delay the salary"
                on={form.salaryHoldEnabled}
                onToggle={() => set({ salaryHoldEnabled: !form.salaryHoldEnabled })}
              />
              {form.salaryHoldEnabled ? (
                <>
                  <Fields>
                    <NumField label="Delay per unapproved day (days)" value={form.unapprovedHoldDays} onChange={(v) => set({ unapprovedHoldDays: v })} error={problemFor("unapprovedHoldDays")} min={0} max={30} />
                  </Fields>
                  <Example>
                    One unapproved day delays the salary by <b>{num(form.unapprovedHoldDays)} days</b>, two days by <b>{num(form.unapprovedHoldDays) * 2}</b>,
                    and three days by <b>{num(form.unapprovedHoldDays) * 3}</b>. The delay is counted from the salary date (day <b>{num(form.salaryDisbursementDay) || 5}</b> of the month after the cycle ends).
                    The salary is not reduced. It is paid in full, later.
                  </Example>
                </>
              ) : (
                <Note>Off. Unapproved days are still unpaid, but they do not delay the salary.</Note>
              )}
              <Note>An admin can release a delay on the Salary page, and that run is then paid on the salary date.</Note>
            </Section>
          </Category>

          {/* ---------------------------------------------------------- Overtime & extras */}
          <Category meta={CATEGORIES[2]}>
            <Section id="rule-overtime" info={INFO.overtime} tone={form.overtimeEnabled ? "on" : "off"} status={form.overtimeEnabled ? "On" : "Off"}>
              <Toggle info={INFO.overtime} label="Pay overtime" on={form.overtimeEnabled} onToggle={() => set({ overtimeEnabled: !form.overtimeEnabled })} />
              {form.overtimeEnabled && (
                <>
                  <Fields cols={3}>
                    <NumField label="Counts after (minutes)" value={form.overtimeMinMinutes} onChange={(v) => set({ overtimeMinMinutes: v })} error={problemFor("overtimeMinMinutes")} min={0} max={240} />
                    <NumField label="Pay rate (× hourly)" value={form.overtimeRate} onChange={(v) => set({ overtimeRate: v })} error={problemFor("overtimeRate")} min={1} max={5} step="0.25" />
                    <NumField label="Max per day (minutes)" value={form.overtimeMaxMinutesPerDay} onChange={(v) => set({ overtimeMaxMinutesPerDay: v })} error={problemFor("overtimeMaxMinutesPerDay")} min={30} max={720} />
                  </Fields>
                  <Example>
                    Staying at least <b>{num(form.overtimeMinMinutes)} min</b> past shift end counts, up to <b>{num(form.overtimeMaxMinutesPerDay)} min</b> a day,
                    paid at <b>{num(form.overtimeRate)}×</b> the hourly rate (daily rate ÷ shift hours).
                    {sampleSalary > 0 && (
                      <> For the sample salary, one hour of overtime pays <b>{money(Math.round((activeRate / 8) * num(form.overtimeRate) * 100) / 100)}</b> on an 8-hour shift.</>
                    )}
                  </Example>
                </>
              )}
            </Section>

            <Section id="rule-comp-off" info={INFO.compOff} tone={form.extraPayEnabled ? "on" : "neutral"} status={form.extraPayEnabled ? "Extra pay on" : "Unused comp-off lapses"}>
              <Example>
                <b>Leave compensation:</b> a weekly off worked in the same cycle as a leave pays for that leave, so the leave day is paid instead of deducted.
                It works the same way whether the weekly off comes before or after the leave.
                <br />
                <b>Lapsing:</b> comp-off that is not used by the last day of the cycle lapses, unless Extra pay is switched on below.
              </Example>
              <SubBlock title="Unused comp-off">
                <Toggle
                  info={INFO.extraPay}
                  label="Extra pay for unused comp-off"
                  on={form.extraPayEnabled}
                  onToggle={() => set({ extraPayEnabled: !form.extraPayEnabled })}
                />
                {form.extraPayEnabled ? (
                  <Fields>
                    <NumField label="Extra pay per unused day (× daily rate)" value={form.extraPayRate} onChange={(v) => set({ extraPayRate: v })} error={problemFor("extraPayRate")} min={0} max={5} step="0.25" />
                  </Fields>
                ) : null}
                <Example>
                  An employee works <b>2 weekly offs</b> and takes <b>1 leave</b> in the same cycle. The leave is paid by one weekly off.
                  The other one is unused comp-off:{" "}
                  {form.extraPayEnabled ? (
                    sampleSalary > 0 ? (
                      <>paid as extra pay, <b>+{money(Math.round(activeRate * num(form.extraPayRate) * 100) / 100)}</b> for the sample salary.</>
                    ) : (
                      <>paid as extra pay at the set multiple of the daily rate.</>
                    )
                  ) : (
                    <>it lapses with no pay.</>
                  )}
                </Example>
              </SubBlock>
            </Section>

            <Section id="rule-holiday-cut" info={INFO.holidayCut} tone={form.holidayDeductionEnabled ? "on" : "off"} status={form.holidayDeductionEnabled ? `On · ${num(form.holidayDeductionTriggerCount)} day trigger` : "Off"}>
              <Toggle
                info={INFO.holidayCutToggle}
                label="Cut weekly-off / holiday pay for unauthorized leave around it"
                on={form.holidayDeductionEnabled}
                onToggle={() => set({ holidayDeductionEnabled: !form.holidayDeductionEnabled })}
              />
              {form.holidayDeductionEnabled && (
                <Fields>
                  <Select
                    label="Unauthorized days that trigger the cut"
                    value={form.holidayDeductionTriggerCount}
                    onChange={(v) => set({ holidayDeductionTriggerCount: v })}
                    options={[
                      { value: "1", label: "1 day: the working day before OR after" },
                      { value: "2", label: "2 days: the working day before AND after" },
                    ]}
                  />
                </Fields>
              )}
              <Example>
                A weekly off is a day the company is closed. An employee takes the working days either side of it off without approval. With <b>2 days</b> selected, the weekly off&apos;s pay
                is cut by <b>one day&apos;s pay</b>{sampleSalary > 0 ? <> (<b>{money(Math.round(activeRate * 100) / 100)}</b> for the sample salary)</> : null}.
                A block of weekly offs and holidays that sit together counts as one block. If the employee works any day in the block, or only one side is
                unauthorized and the trigger is 2, nothing is cut. Approved leave never triggers the cut.
              </Example>
              {!form.holidayDeductionEnabled && <Note>Off. Weekly-off and holiday pay is never cut.</Note>}
            </Section>
          </Category>

          {/* ---------------------------------------------------------- Weekly offs & holidays */}
          <Category meta={CATEGORIES[3]}>
            <Section id="rule-weekly-off" info={INFO.weeklyOff} tone={offDays.length > 0 ? "on" : "off"} status={offNames}>
              <div role="group" aria-label="Weekly off days" className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                {WEEKDAYS.map((d) => {
                  const on = offDays.includes(d.n);
                  return (
                    <button
                      key={d.n}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleOffDay(d.n)}
                      className={`min-h-12 rounded-xl border px-2 py-2 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
                        on ? "border-indigo-600 bg-indigo-600 text-white shadow-sm" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                      }`}
                    >
                      <span className="block text-sm font-bold">{d.short}</span>
                      <span className={`block text-[10px] font-semibold ${on ? "text-indigo-100" : "text-slate-400"}`}>{on ? "Weekly off" : "Working"}</span>
                    </button>
                  );
                })}
              </div>
              <Example>
                Saturday is {offDays.includes(6) ? <b>a weekly off</b> : <b>a normal working day</b>}
                {offDays.includes(6)
                  ? ": nobody is marked absent on it, and it is paid. Untick it above if your company works on Saturdays."
                  : ": a missing punch-in on a Saturday is an absence, and Saturday punches count as a regular day."}{" "}
                Weekly offs are paid inside the salary month. Working on one earns a comp-off day.
              </Example>
              <Note>
                Weekly offs are left out of the working-days divisor when that basis is chosen (see Daily pay &amp; deductions). Press Save rules to apply a change.
              </Note>
            </Section>

            <Section
              id="rule-paid-holidays"
              info={INFO.paidHoliday}
              tone={cycleHolidays.length > 0 ? "on" : "neutral"}
              status={`${cycleHolidays.length} ${cycleHolidays.length === 1 ? "holiday" : "holidays"} in the cycle shown`}
            >
              <div className="mb-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setHCycle(shiftCycleKey(selCycleKey, -1) === nowCycleKey ? "" : shiftCycleKey(selCycleKey, -1))}
                  aria-label="Previous salary cycle"
                  className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-lg text-slate-600 hover:bg-slate-50"
                >
                  ‹
                </button>
                <div className="min-w-0 flex-1 rounded-xl bg-white px-3 py-2 text-center ring-1 ring-slate-200">
                  <p className="text-sm font-bold text-slate-900">{formatDayKey(selStart)} – {formatDayKey(selEnd)}</p>
                  <p className="text-[11px] font-medium text-slate-500">{selCycleKey === nowCycleKey ? "Current salary cycle" : "Salary cycle"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setHCycle(shiftCycleKey(selCycleKey, 1) === nowCycleKey ? "" : shiftCycleKey(selCycleKey, 1))}
                  aria-label="Next salary cycle"
                  className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-lg text-slate-600 hover:bg-slate-50"
                >
                  ›
                </button>
              </div>
              {selCycleKey !== nowCycleKey && (
                <button type="button" onClick={() => setHCycle("")} className="mb-3 text-xs font-semibold text-indigo-600 hover:underline">
                  Back to the current cycle
                </button>
              )}

              {selLocked && (
                <p className="mb-3 rounded-xl bg-amber-50 px-3.5 py-3 text-[13px] font-medium leading-relaxed text-amber-800">
                  The salary for this cycle is already finalized, so its holidays are locked. This keeps the pay that was finalized correct.
                </p>
              )}

              {cycleHolidays.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-5 text-center text-sm text-slate-500">
                  No paid holidays in this cycle yet.
                </p>
              ) : (
                <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {cycleHolidays.map((h) => {
                    const day = h.holidayDate.slice(0, 10);
                    const when = day < todayKey ? "Passed" : day === todayKey ? "Today" : "Upcoming";
                    return (
                      <li key={h.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-900">{h.name}</p>
                          <p className="text-xs text-slate-500">
                            {formatDayKey(day)} · {weekdayOf(day)}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                            when === "Passed" ? "bg-slate-100 text-slate-500" : when === "Today" ? "bg-indigo-50 text-indigo-700" : "bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {when}
                        </span>
                        {!selLocked && (
                          <button
                            type="button"
                            onClick={() => removeHoliday(h)}
                            disabled={hBusy}
                            className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {!selLocked && (
                <SubBlock title="Add a paid holiday">
                  <Fields>
                    <Input label="Date (inside this cycle)" type="date" min={selStart} max={selEnd} value={hDate} onChange={setHDate} />
                    <Input label="Holiday name" value={hName} onChange={setHName} placeholder="e.g. Diwali" />
                  </Fields>
                  {hError && (
                    <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3.5 py-3 text-[13px] font-medium leading-relaxed text-rose-700">
                      {hError}
                    </p>
                  )}
                  <Button className="mt-3 w-full sm:w-auto" onClick={() => addHoliday(selStart, selEnd)} loading={hBusy} disabled={!hDate || !hName.trim()}>
                    Add paid holiday
                  </Button>
                  <Example>
                    {hDate && hName.trim() ? (
                      <>
                        <b>{formatDayKey(hDate)}</b> becomes a paid holiday called <b>{hName.trim()}</b>. Nobody is marked absent for it and nothing is deducted
                        {hDate < todayKey ? ". The day has already passed, so attendance and pay for this cycle are recalculated as soon as you add it" : ""}.
                      </>
                    ) : (
                      <>
                        Pick a date and a name. A paid holiday is saved straight away, and past dates are allowed while the cycle&apos;s salary is not finalized.
                        It shows as <b>Holiday</b> on the Attendance page.
                      </>
                    )}
                  </Example>
                </SubBlock>
              )}
            </Section>
          </Category>

          {/* ---------------------------------------------------------- Salary cycle & leave */}
          <Category meta={CATEGORIES[4]}>
            <Section
              id="rule-salary-cycle"
              info={INFO.salaryCycle}
              status={`Starts on day ${num(form.salaryCycleStartDay)} · paid on the ${ordinal(num(form.salaryDisbursementDay) || 5)}`}
            >
              <Fields>
                <NumField
                  label={`Cycle starts on day (${MIN_START_DAY}–${MAX_START_DAY})`}
                  value={form.salaryCycleStartDay}
                  onChange={(v) => set({ salaryCycleStartDay: v })}
                  error={problemFor("salaryCycleStartDay")}
                  min={MIN_START_DAY}
                  max={MAX_START_DAY}
                />
                <Select
                  label="Salary date (day of the month after the cycle ends)"
                  value={String(num(form.salaryDisbursementDay) || 5)}
                  onChange={(v) => set({ salaryDisbursementDay: v })}
                  options={Array.from({ length: MAX_START_DAY }, (_, i) => ({ value: String(i + 1), label: `${ordinal(i + 1)} of the month` }))}
                />
              </Fields>
              <p className="mb-2 mt-4 text-xs font-semibold text-slate-600">Quick pick for the cycle start</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[1, 6, 11, 16, 21, 26].map((d) => (
                  <Button
                    key={d}
                    size="sm"
                    variant={num(form.salaryCycleStartDay) === d ? "primary" : "secondary"}
                    onClick={() => set({ salaryCycleStartDay: String(d) })}
                  >
                    {d === 1 ? "Calendar month (1st → month end)" : `${ordinal(d)} → ${ordinal(d - 1)}`}
                  </Button>
                ))}
              </div>
              {form.salaryCycleStartDay !== savedStartDay && !problemFor("salaryCycleStartDay") && (
                <p className="mt-3 rounded-xl bg-amber-50 px-3.5 py-3 text-[13px] font-medium leading-relaxed text-amber-800">
                  Changing the cycle: salaries you already finalized keep their original dates, but any cycle not yet finalized is recalculated with the new dates.
                  To avoid overlapping or skipped days, change this right after you finalize a cycle.
                </p>
              )}
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
                  <p className="text-xs font-semibold text-slate-500">Current cycle</p>
                  <p className="mt-0.5 text-sm font-bold text-slate-900">{formatDayKey(example.periodStart)} – {formatDayKey(example.periodEnd)}</p>
                  <p className="mt-0.5 text-xs text-slate-500">Salary date {formatDayKey(example.salaryDate)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
                  <p className="text-xs font-semibold text-slate-500">Next cycle</p>
                  <p className="mt-0.5 text-sm font-bold text-slate-900">{formatDayKey(example.nextStart)} – {formatDayKey(example.nextEnd)}</p>
                </div>
              </div>
              <Example>
                A cycle runs from its start day up to the day before the next one. Day 1 means the calendar month. Day 26 means
                <b> 26th → 25th</b>. The salary for each cycle is paid on the <b>{ordinal(num(form.salaryDisbursementDay) || 5)}</b> of the month after it ends.
                A cycle can only be finalized after its last day. Salary is set per employee on the <Link href="/employees" className="font-bold underline">Employees</Link> page.
              </Example>
            </Section>

            <Section id="rule-leave-accrual" info={INFO.leaveAccrual} status={form.leaveAccrualMode === "lapse" ? "Lapses monthly" : "Carry forward"}>
              <div role="radiogroup" aria-label="Leave accrual mode" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[
                  { value: "carry" as const, title: "Carry forward", text: "Unused leave accumulates and can be used later in the year." },
                  { value: "lapse" as const, title: "Lapse monthly", text: "The month's leave must be taken in that month, or it lapses." },
                ].map((o) => {
                  const selected = form.leaveAccrualMode === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => set({ leaveAccrualMode: o.value })}
                      className={`flex min-h-14 items-start gap-3 rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
                        selected ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${selected ? "border-indigo-600" : "border-slate-300"}`}
                      >
                        {selected && <span className="h-2.5 w-2.5 rounded-full bg-indigo-600" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-slate-900">{o.title}</span>
                        <span className="mt-0.5 block text-[13px] leading-snug text-slate-500">{o.text}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <Example>
                All accrued leave needs admin approval and is recorded as <b>Casual</b> or <b>Medical</b> leave. Approved leave beyond the
                available balance is still allowed and is deducted as unpaid leave.
              </Example>
            </Section>

            <Section id="rule-mid-cycle-slip" info={INFO.midCycleSlip} tone={form.midCycleSlipEnabled ? "on" : "off"} status={form.midCycleSlipEnabled ? "On" : "Off"}>
              <Toggle
                info={INFO.midCycleSlip}
                label="Allow slips for the cycle that is still running"
                on={form.midCycleSlipEnabled}
                onToggle={() => set({ midCycleSlipEnabled: !form.midCycleSlipEnabled })}
              />
              <Example>
                {form.midCycleSlipEnabled ? (
                  <>
                    Employees can request a <b>provisional</b> slip for the current cycle. It shows the figures up to the day your admin approves it. Once the cycle is finalized,
                    the final figures are used. Finalized cycles work as before.
                  </>
                ) : (
                  <>Off. A slip can be requested only after its salary cycle is finalized.</>
                )}
              </Example>
            </Section>
          </Category>

          {/* ---------------------------------------------------------- Records */}
          <Category meta={CATEGORIES[5]}>
            <Section id="rule-retention" info={INFO.retention} status="Photos 45 days · records 90 days">
              <dl className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
                {[
                  { k: "Punch photos", v: <>Kept for <b>45 days</b> after the work date, then deleted. The punch times and location stay.</> },
                  { k: "Attendance records", v: <>Without photos, kept for <b>90 days</b> so admins can still review them. Older records are deleted.</> },
                  { k: "Unfinalized salary", v: <>Records are never deleted while their salary cycle is not finalized, so pay can always be calculated.</> },
                  { k: "Salary slips", v: <>An employee can download an approved slip for <b>90 days</b> after the admin approves the request.</> },
                  { k: "Photo capture", v: <>Taken only with the in-app camera. Gallery uploads and mock-location (fake GPS) apps are blocked, and the attempt is logged.</> },
                ].map((row) => (
                  <div key={row.k} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:gap-4">
                    <dt className="text-[13px] font-bold text-slate-900 sm:w-40 sm:shrink-0">{row.k}</dt>
                    <dd className="text-[13px] leading-relaxed text-slate-600 [&_b]:font-bold [&_b]:text-slate-900">{row.v}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          </Category>
        </div>

        {/* Glossary: the words used above, in one place */}
        <section className="mt-10" hidden={searching}>
          <Card className="p-4 sm:p-5">
            <h2 className="text-sm font-bold text-slate-900">Words used on this page</h2>
            <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {GLOSSARY.map((g) => (
                <div key={g.term}>
                  <dt className="text-[13px] font-bold text-slate-900">{g.term}</dt>
                  <dd className="mt-0.5 text-[13px] leading-relaxed text-slate-600">{g.text}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </section>
      </div>

      {/* Success note: stays in view wherever you are on the page, then fades away */}
      {message && (
        <div
          role="status"
          className={`fixed inset-x-4 z-50 mx-auto flex max-w-md items-start gap-3 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white shadow-lg lg:left-72 lg:right-0 ${
            dirty ? "bottom-[calc(8.5rem+env(safe-area-inset-bottom))] lg:bottom-24" : "bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:bottom-6"
          }`}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" fill="currentColor">
            <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 111.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" />
          </svg>
          <span className="min-w-0 flex-1 leading-snug">{message}</span>
          <button type="button" onClick={() => setMessage("")} aria-label="Dismiss" className="-mr-1 shrink-0 rounded-md px-1.5 text-lg leading-none text-white/80 hover:text-white">
            ×
          </button>
        </div>
      )}

      {/* Unsaved changes: sits above the phone's bottom tab bar, and beside the sidebar on laptops */}
      {dirty && (
        <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-40 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur lg:bottom-0 lg:left-72 lg:px-8">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <p className={`flex min-w-0 items-center gap-2 text-sm font-semibold ${errorCount > 0 ? "text-rose-700" : "text-amber-700"}`}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${errorCount > 0 ? "bg-rose-500" : "bg-amber-500"}`} aria-hidden="true" />
              <span className="truncate">
                {errorCount > 0
                  ? `${errorCount} ${errorCount === 1 ? "setting" : "settings"} to fix`
                  : changes.length > 0
                    ? `${changes.length} unsaved ${changes.length === 1 ? "change" : "changes"}`
                    : "Unsaved changes"}
              </span>
            </p>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="hidden sm:inline-flex"
                onClick={() => {
                  setReviewOpen(true);
                  document.getElementById("rules-review")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                Review
              </Button>
              <Button variant="secondary" size="sm" onClick={discard}>Discard</Button>
              <Button size="sm" onClick={save} loading={saving} disabled={errorCount > 0}>Save rules</Button>
            </div>
          </div>
        </div>
      )}
    </PageBusContext.Provider>
  );
}
