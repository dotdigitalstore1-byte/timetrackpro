// Pure logic for the Rules page: which values are allowed, what a change will do, how one day would be
// counted, and how the search matches rules. It has no imports, so the browser page and the unit tests
// can both use it. The limits below mirror the checks in src/app/api/settings/route.ts.

/** The groups on the Rules page, in the order an admin reads them. */
export type RuleCategory = "hours" | "pay" | "extra" | "days" | "cycle" | "records";

export interface RuleInfo {
  id: string;
  category: RuleCategory;
  title: string;
  hint: string;
  keywords: string[];
}

/** Every rule on the page. The page reads titles and hints from here, so search and the screen always agree. */
export const RULES: RuleInfo[] = [
  {
    id: "rule-late",
    category: "hours",
    title: "Late arrival & cool-off time",
    hint: "A short window after shift start in which a late punch still counts as on time.",
    keywords: ["late", "late arrival", "cool off", "cooloff", "grace", "on time", "punch in", "late deduction", "half day cut-off"],
  },
  {
    id: "rule-late-marks",
    category: "hours",
    title: "Late marks",
    hint: "Optional: every few late days cost extra salary on top of the per-late deduction. Set 0 to turn off.",
    keywords: ["late marks", "late days", "penalty", "repeated late", "frequent late"],
  },
  {
    id: "rule-early-leave",
    category: "hours",
    title: "Early leave",
    hint: "Leaving before the shift ends. A cool-off lets people leave a few minutes early without penalty.",
    keywords: ["early leave", "leave early", "left early", "punch out", "early exit", "cool off", "half day"],
  },
  {
    id: "rule-half-day",
    category: "pay",
    title: "Half-day deduction",
    hint: "What a half day costs when an employee punches in too late or leaves too early for a full day.",
    keywords: ["half day", "half-day", "deduction", "cut", "pay cut"],
  },
  {
    id: "rule-auto-absent",
    category: "hours",
    title: "Late-percentage auto-absent",
    hint: "Punching in after a set share of the shift marks the whole day absent, not late or half day.",
    keywords: ["absent", "auto absent", "percentage", "share of shift", "cut off", "late"],
  },
  {
    id: "rule-overtime",
    category: "extra",
    title: "Overtime",
    hint: "Pay extra for time worked after the shift ends.",
    keywords: ["overtime", "extra hours", "after shift", "pay rate", "extra pay"],
  },
  {
    id: "rule-comp-off",
    category: "extra",
    title: "Weekly-off work & comp-off",
    hint: "Working on a weekly off (Sunday by default) earns one comp-off day, which must be used in the same salary cycle.",
    keywords: ["comp off", "comp-off", "compensatory", "sunday", "weekly off", "leave compensation", "lapse", "unused", "extra pay"],
  },
  {
    id: "rule-holiday-cut",
    category: "extra",
    title: "Sunday & holiday pay cut",
    hint: "Cuts Sunday or holiday pay when an employee takes unauthorized leave right before and after it.",
    keywords: ["sunday", "holiday", "pay cut", "unauthorized", "unapproved", "leave around", "trigger"],
  },
  {
    id: "rule-leave-deduction",
    category: "pay",
    title: "Approved leave deduction",
    hint: "What each approved leave day costs when comp-off does not cover it.",
    keywords: ["leave", "deduction", "unpaid leave", "approved leave", "leave pay"],
  },
  {
    id: "rule-salary-hold",
    category: "pay",
    title: "Salary hold for unapproved absence",
    hint: "Delays the pay date for each unapproved absence day. The salary amount itself is not reduced.",
    keywords: ["hold", "delay", "unapproved", "absence", "salary date", "release", "pay date"],
  },
  {
    id: "rule-salary-basis",
    category: "pay",
    title: "Daily rate: how a day's pay is worked out",
    hint: "The daily rate is basic salary divided by a number of days. Choose which number, and every per-day deduction follows it.",
    keywords: ["daily rate", "per day", "basis", "divide", "divisor", "30 days", "working days", "calendar days", "weekly off", "sunday excluded", "salary base", "basic", "february"],
  },
  {
    id: "rule-leave-accrual",
    category: "cycle",
    title: "Leave accrual",
    hint: "Each employee earns 1 leave per month, starting from their joining month. A new joiner in November sees 1 leave, not 12.",
    keywords: ["leave", "accrual", "carry forward", "lapse", "annual leave", "joining", "balance"],
  },
  {
    id: "rule-salary-cycle",
    category: "cycle",
    title: "Salary cycle & salary date",
    hint: "The period each salary covers, and the day of the next month it is paid.",
    keywords: ["cycle", "salary date", "pay date", "start day", "period", "payday", "payroll"],
  },
  {
    id: "rule-weekly-off",
    category: "days",
    title: "Weekly off days",
    hint: "Days your company is closed every week. Every day you do not tick is a normal working day.",
    keywords: ["weekly off", "off day", "sunday", "saturday", "working day", "closed", "week off"],
  },
  {
    id: "rule-paid-holidays",
    category: "days",
    title: "Paid holidays",
    hint: "Make any day of a salary cycle a paid holiday, including days that have already passed.",
    keywords: ["holiday", "diwali", "festival", "public holiday", "paid day", "office closed"],
  },
  {
    id: "rule-retention",
    category: "records",
    title: "Photos, attendance records & salary slips",
    hint: "What is kept, for how long, and who can see it.",
    keywords: ["photo", "retention", "delete", "privacy", "records", "slip", "download", "keep", "history"],
  },
  {
    id: "rule-mid-cycle-slip",
    category: "cycle",
    title: "Salary slips during a running cycle",
    hint: "Let employees ask for a slip before their salary cycle ends, for example when resigning mid-month.",
    keywords: ["slip", "payslip", "resign", "provisional", "mid cycle", "running cycle"],
  },
];

export const RULE_BY_ID: Record<string, RuleInfo> = Object.fromEntries(RULES.map((r) => [r.id, r]));

export const WEEKDAYS = [
  { n: 0, short: "Sun", long: "Sunday" },
  { n: 1, short: "Mon", long: "Monday" },
  { n: 2, short: "Tue", long: "Tuesday" },
  { n: 3, short: "Wed", long: "Wednesday" },
  { n: 4, short: "Thu", long: "Thursday" },
  { n: 5, short: "Fri", long: "Friday" },
  { n: 6, short: "Sat", long: "Saturday" },
];

/** The rule values as the page holds them: numbers are typed as text while editing. */
export type RuleValues = Readonly<Record<string, string | boolean>>;

/** JS weekday numbers (0 = Sunday) from a comma list, sorted and without duplicates. */
export function parseOffDays(value: string): number[] {
  const days = value
    .split(",")
    .filter((x) => x.trim() !== "") // an empty list means no weekly off (Number("") would read as Sunday)
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return [...new Set(days)].sort((a, b) => a - b);
}

export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

const text = (v: string | boolean | undefined): string => String(v ?? "").trim();

/** A number typed in a field; anything that is not a number reads as 0. Only used after validation. */
const toNum = (v: string | boolean | undefined): number => {
  const n = Number(text(v));
  return text(v) === "" || !Number.isFinite(n) ? 0 : n;
};

/** "HH:MM" to minutes since midnight, or null when the text is not a valid time. */
function clockMinutes(hhmm: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes since midnight to "HH:MM" (rounded, wrapped to one day). */
export function clockOf(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ validation

export interface RuleProblem {
  field: string;
  ruleId: string;
  message: string;
}

/** Returns an error message, or null when the value is a whole or decimal number inside the range. */
function numberProblem(raw: string | boolean | undefined, min: number, max: number | null, whole: boolean): string | null {
  const t = text(raw);
  const n = Number(t);
  if (t === "" || !Number.isFinite(n)) return "Enter a number.";
  if (whole && !Number.isInteger(n)) return "Use a whole number.";
  if (n < min) return max === null ? `Enter ${min} or more.` : `Enter a value from ${min} to ${max}.`;
  if (max !== null && n > max) return `Enter a value from ${min} to ${max}.`;
  return null;
}

/**
 * Every problem with the rules as they are typed. The page blocks saving while this list is not empty,
 * so nothing is silently rounded or clamped by the server. Hidden rules (switched off) are only checked
 * when they are on, because their values do not affect pay.
 */
export function validateRules(v: RuleValues): RuleProblem[] {
  const out: RuleProblem[] = [];
  const add = (field: string, ruleId: string, message: string | null) => {
    if (message) out.push({ field, ruleId, message });
  };
  const on = (flag: string) => v[flag] === true;
  const isPercent = (typeField: string) => v[typeField] !== "fixed";
  const amount = (field: string, typeField: string, ruleId: string) =>
    add(field, ruleId, numberProblem(v[field], 0, isPercent(typeField) ? 100 : null, false));

  // Late arrival
  const grace = numberProblem(v.graceMinutes, 0, 120, true);
  add("graceMinutes", "rule-late", grace);
  const lateCut = numberProblem(v.lateThresholdMinutes, 0, 720, true);
  add("lateThresholdMinutes", "rule-late", lateCut);
  if (!grace && !lateCut && toNum(v.lateThresholdMinutes) < toNum(v.graceMinutes)) {
    add("lateThresholdMinutes", "rule-late", "The half-day cut-off must be later than the cool-off.");
  }
  amount("lateDeductionValue", "lateDeductionType", "rule-late");

  // Late marks
  add("lateMarksLimit", "rule-late-marks", numberProblem(v.lateMarksLimit, 0, 31, true));
  add("lateMarksPenaltyDays", "rule-late-marks", numberProblem(v.lateMarksPenaltyDays, 0, 5, false));

  // Early leave
  const eGrace = numberProblem(v.earlyLeaveGraceMinutes, 0, 120, true);
  add("earlyLeaveGraceMinutes", "rule-early-leave", eGrace);
  const eHalf = numberProblem(v.earlyLeaveHalfDayMinutes, 0, 720, true);
  add("earlyLeaveHalfDayMinutes", "rule-early-leave", eHalf);
  if (!eGrace && !eHalf && toNum(v.earlyLeaveHalfDayMinutes) > 0 && toNum(v.earlyLeaveHalfDayMinutes) < toNum(v.earlyLeaveGraceMinutes)) {
    add("earlyLeaveHalfDayMinutes", "rule-early-leave", "Use 0 to turn this off, or a time longer than the early-leave cool-off.");
  }
  amount("earlyLeaveDeductionValue", "earlyLeaveDeductionType", "rule-early-leave");

  // Half day and approved leave
  amount("halfDayDeductionValue", "halfDayDeductionType", "rule-half-day");
  amount("leaveDeductionValue", "leaveDeductionType", "rule-leave-deduction");

  // Salary hold (only when on)
  if (on("salaryHoldEnabled")) add("unapprovedHoldDays", "rule-salary-hold", numberProblem(v.unapprovedHoldDays, 0, 30, true));

  // Overtime (only when on)
  if (on("overtimeEnabled")) {
    add("overtimeMinMinutes", "rule-overtime", numberProblem(v.overtimeMinMinutes, 0, 240, true));
    add("overtimeRate", "rule-overtime", numberProblem(v.overtimeRate, 1, 5, false));
    add("overtimeMaxMinutesPerDay", "rule-overtime", numberProblem(v.overtimeMaxMinutesPerDay, 30, 720, true));
  }

  // Comp-off extra pay (only when on)
  if (on("extraPayEnabled")) add("extraPayRate", "rule-comp-off", numberProblem(v.extraPayRate, 0, 5, false));

  // Late-percentage auto-absent (only when on)
  if (on("absentAfterPercentEnabled")) {
    add("absentAfterPercent", "rule-auto-absent", numberProblem(v.absentAfterPercent, 10, 100, true));
  }

  // Salary cycle
  add("salaryCycleStartDay", "rule-salary-cycle", numberProblem(v.salaryCycleStartDay, 1, 28, true));

  return out;
}

// ------------------------------------------------------------------ summary

/** A rupee amount, with Indian digit grouping and at most two decimals. */
export function money(n: number): string {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** The salary basis in plain words: which number the daily rate is divided by. */
export const SALARY_BASIS_OPTIONS: { value: "fixed" | "working" | "calendar"; title: string; text: string }[] = [
  { value: "fixed", title: "Fixed 30-day month", text: "Basic ÷ 30 in every month. Weekly offs count as paid days. This is the standard." },
  { value: "working", title: "Working days only", text: "Basic ÷ the working days in the cycle. Weekly offs are left out, so each day costs more." },
  { value: "calendar", title: "Calendar days", text: "Basic ÷ the actual days in the cycle (28, 30 or 31). The daily rate moves with the calendar." },
];

export function basisLabel(value: string | boolean | undefined): string {
  if (value === "working") return "Basic ÷ working days in the cycle";
  if (value === "calendar") return "Basic ÷ calendar days in the cycle";
  return "Basic ÷ 30 (standard month)";
}

/**
 * How a deduction reads in plain words, e.g. "50% of the daily rate" or "fixed ₹200". When the daily rate is
 * known (for example from the sample salary on the page), the rupee amount is added.
 */
export function deductionText(
  type: string | boolean | undefined,
  value: string | boolean | undefined,
  dailyRate?: number
): string {
  const n = toNum(value);
  if (n <= 0) return "No deduction";
  if (type === "fixed") return `fixed ${money(n)}`;
  const base = `${n}% of the daily rate`;
  return dailyRate !== undefined && dailyRate > 0 ? `${base}, which is ${money((dailyRate * n) / 100)}` : base;
}

export interface RuleSummaryItem {
  key: string;
  label: string;
  value: string;
}

/**
 * Every setting in plain words. A switched-off rule shows "Off" whatever its hidden values are, so editing
 * a hidden number does not appear as a change that affects pay.
 */
export function summarizeRules(v: RuleValues): RuleSummaryItem[] {
  const on = (k: string) => v[k] === true;
  const offDays = parseOffDays(text(v.weeklyOff));
  return [
    { key: "basis", label: "Daily rate basis", value: basisLabel(v.dailyRateBasis) },
    { key: "weeklyOff", label: "Weekly off days", value: offDays.length ? offDays.map((n) => WEEKDAYS[n].long).join(", ") : "None" },
    { key: "grace", label: "Late cool-off", value: `${toNum(v.graceMinutes)} min after shift start` },
    { key: "lateCut", label: "Half-day cut-off (late)", value: `${toNum(v.lateThresholdMinutes)} min after shift start` },
    { key: "lateDed", label: "Late deduction", value: deductionText(v.lateDeductionType, v.lateDeductionValue) },
    {
      key: "lateMarks",
      label: "Late marks",
      value: toNum(v.lateMarksLimit) > 0 ? `Every ${toNum(v.lateMarksLimit)} late days cost ${toNum(v.lateMarksPenaltyDays)} day(s) of pay` : "Off",
    },
    { key: "earlyGrace", label: "Early-leave cool-off", value: `${toNum(v.earlyLeaveGraceMinutes)} min` },
    {
      key: "earlyHalf",
      label: "Early leave becomes a half day",
      value: toNum(v.earlyLeaveHalfDayMinutes) > 0 ? `When leaving more than ${toNum(v.earlyLeaveHalfDayMinutes)} min early` : "Off",
    },
    { key: "earlyDed", label: "Early-leave deduction", value: deductionText(v.earlyLeaveDeductionType, v.earlyLeaveDeductionValue) },
    { key: "halfDed", label: "Half-day deduction", value: deductionText(v.halfDayDeductionType, v.halfDayDeductionValue) },
    { key: "leaveDed", label: "Approved-leave deduction", value: deductionText(v.leaveDeductionType, v.leaveDeductionValue) },
    {
      key: "hold",
      label: "Salary hold",
      value: on("salaryHoldEnabled") ? `${toNum(v.unapprovedHoldDays)} days per unapproved day` : "Off",
    },
    {
      key: "autoAbsent",
      label: "Auto-absent after a share of the shift",
      value: on("absentAfterPercentEnabled") ? `${toNum(v.absentAfterPercent)}% of the shift` : "Off",
    },
    {
      key: "overtime",
      label: "Overtime",
      value: on("overtimeEnabled")
        ? `After ${toNum(v.overtimeMinMinutes)} min, up to ${toNum(v.overtimeMaxMinutesPerDay)} min a day, at ${toNum(v.overtimeRate)}×`
        : "Off",
    },
    {
      key: "extraPay",
      label: "Extra pay for unused comp-off",
      value: on("extraPayEnabled") ? `${toNum(v.extraPayRate)}× the daily rate` : "Off",
    },
    {
      key: "holidayCut",
      label: "Sunday & holiday pay cut",
      value: on("holidayDeductionEnabled") ? `On, after ${toNum(v.holidayDeductionTriggerCount)} unauthorized day(s)` : "Off",
    },
    { key: "accrual", label: "Leave accrual", value: v.leaveAccrualMode === "lapse" ? "Lapses monthly" : "Carry forward" },
    { key: "cycleStart", label: "Salary cycle starts on", value: `Day ${toNum(v.salaryCycleStartDay)}` },
    { key: "salaryDate", label: "Salary date", value: `${ordinal(toNum(v.salaryDisbursementDay))} of the next month` },
    { key: "midSlip", label: "Slips for a running cycle", value: on("midCycleSlipEnabled") ? "On" : "Off" },
  ];
}

export interface RuleChange {
  key: string;
  label: string;
  from: string;
  to: string;
}

/** The settings whose plain-words summary differs between the saved rules and the rules on screen. */
export function changesBetween(before: RuleValues | null, after: RuleValues): RuleChange[] {
  if (!before) return [];
  const a = summarizeRules(before);
  const b = summarizeRules(after);
  return b.flatMap((item, i) =>
    a[i].value === item.value ? [] : [{ key: item.key, label: item.label, from: a[i].value, to: item.value }]
  );
}

// ------------------------------------------------------------------ test a day

export type PreviewTone = "good" | "warn" | "bad" | "info";

export interface PreviewLine {
  title: string;
  tone: PreviewTone;
  detail: string;
}

/**
 * What the rules would do with one day's punches. It follows the same order as the server: the
 * late-percentage cut-off first, then the cool-off, late and half-day cut-offs, then early leave and overtime.
 * Returns no lines until a valid punch-in time is entered.
 */
export function previewDay(v: RuleValues, punchInText: string, punchOutText: string, dailyRate?: number): PreviewLine[] {
  const start = clockMinutes(text(v.shiftStart));
  const end = clockMinutes(text(v.shiftEnd));
  const punchIn = clockMinutes(punchInText);
  if (start === null || end === null || punchIn === null) return [];

  const lines: PreviewLine[] = [];
  const grace = toNum(v.graceMinutes);
  const lateCut = toNum(v.lateThresholdMinutes);
  const lateMarks = toNum(v.lateMarksLimit);
  const absentPct = v.absentAfterPercentEnabled === true ? toNum(v.absentAfterPercent) : 0;
  // The cut-off only exists when the rule is on and the shift is longer than zero, as on the server.
  const absentCut = absentPct > 0 && end > start ? start + ((end - start) * Math.min(100, absentPct)) / 100 : null;

  if (absentCut !== null && punchIn > absentCut) {
    lines.push({
      title: "Absent",
      tone: "bad",
      detail: `Punched in after ${clockOf(absentCut)}, the ${absentPct}% cut-off for this shift. The day is recorded as absent and is unpaid. No late or half-day deduction applies.`,
    });
  } else if (punchIn <= start + grace) {
    lines.push({
      title: "On time",
      tone: "good",
      detail: `Full day with no deduction. Punch-ins up to ${clockOf(start + grace)} are within the ${grace}-minute cool-off.`,
    });
  } else if (punchIn <= start + lateCut) {
    const marks =
      lateMarks > 0
        ? ` It also counts towards the late marks: every ${lateMarks} late days cost ${toNum(v.lateMarksPenaltyDays)} day(s) of pay.`
        : "";
    lines.push({
      title: "Late",
      tone: "warn",
      detail: `Late deduction: ${deductionText(v.lateDeductionType, v.lateDeductionValue, dailyRate)}.${marks}`,
    });
  } else {
    lines.push({
      title: "Half day",
      tone: "bad",
      detail: `Half-day deduction: ${deductionText(v.halfDayDeductionType, v.halfDayDeductionValue, dailyRate)}.`,
    });
  }

  const punchOut = clockMinutes(punchOutText);
  if (punchOut !== null) {
    const earlyBy = end - punchOut;
    const eGrace = toNum(v.earlyLeaveGraceMinutes);
    const eHalf = toNum(v.earlyLeaveHalfDayMinutes);
    if (earlyBy > 0 && eHalf > 0 && earlyBy > eHalf) {
      lines.push({
        title: "Half day (left early)",
        tone: "bad",
        detail: `Left ${earlyBy} minutes before shift end, more than the ${eHalf}-minute limit. Half-day deduction: ${deductionText(v.halfDayDeductionType, v.halfDayDeductionValue, dailyRate)}.`,
      });
    } else if (earlyBy > eGrace) {
      const ded =
        toNum(v.earlyLeaveDeductionValue) > 0
          ? `Early-leave deduction: ${deductionText(v.earlyLeaveDeductionType, v.earlyLeaveDeductionValue, dailyRate)}.`
          : "No early-leave deduction is set, so this costs nothing.";
      lines.push({ title: "Early leave", tone: "warn", detail: `Left ${earlyBy} minutes before shift end. ${ded}` });
    } else {
      lines.push({
        title: "Left on time",
        tone: "good",
        detail: earlyBy > 0 ? `Left within the ${eGrace}-minute early-leave cool-off.` : "Stayed until shift end.",
      });
    }

    const after = punchOut - end;
    if (after > 0) {
      if (v.overtimeEnabled !== true) {
        lines.push({ title: "Overtime", tone: "info", detail: `${after} minutes after shift end. Overtime pay is off, so nothing is added.` });
      } else {
        const min = toNum(v.overtimeMinMinutes);
        const max = toNum(v.overtimeMaxMinutesPerDay);
        const rate = toNum(v.overtimeRate);
        if (after >= min) {
          const paid = Math.min(after, max);
          lines.push({
            title: "Overtime",
            tone: "good",
            detail: `${paid} minutes paid at ${rate}× the hourly rate${after > max ? `, capped at ${max} minutes a day` : ""}.`,
          });
        } else {
          lines.push({
            title: "Overtime",
            tone: "info",
            detail: `${after} minutes after shift end. Overtime starts counting once the employee stays ${min} minutes past shift end.`,
          });
        }
      }
    }
  }

  return lines;
}

// ------------------------------------------------------------------ search

/** True when every word typed appears somewhere in the text. An empty search matches everything. */
export function matchesQuery(query: string, haystack: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const h = haystack.toLowerCase();
  return words.every((w) => h.includes(w));
}

/** Ids of the rules a search matches, in page order. */
export function rulesMatching(query: string): string[] {
  return RULES.filter((r) => matchesQuery(query, `${r.title} ${r.hint} ${r.keywords.join(" ")}`)).map((r) => r.id);
}
