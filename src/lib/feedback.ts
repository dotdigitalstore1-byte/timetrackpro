// Periodic feedback for company admins. Dependency-free so it can be unit-tested and shared by client and server.
//
// Three prompts per payroll cycle: the cycle is split into thirds, and the admin is asked once per third.
// Each question has checkbox options. Every option carries a "leniency" weight from 0 (strict) to 3 (most lenient).
// The leniency index (0-100) is the average of the chosen options, so it can be compared across companies.

// Date helpers kept local so this file has no imports (the tests run it without the @/ path alias).
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function isDayKey(v: string): boolean {
  const m = KEY_RE.exec(v);
  if (!m) return false;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return t.getUTCDate() === Number(m[3]);
}
function diffDayKeys(from: string, to: string): number {
  const t = (k: string) => {
    const m = KEY_RE.exec(k)!;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };
  return Math.round((t(to) - t(from)) / 86400000);
}

export const QUESTIONNAIRE_VERSION = 1;
export const SLOTS_PER_CYCLE = 3;

export const AWARENESS_TITLE = "Building a supportive, fair attendance culture";

/** Shown in a scrollable box above the questions. Plain language, no legal advice. */
export const AWARENESS_TEXT = [
  "Attendance rules exist to keep teams reliable and fair. They work best when people trust that a small, honest mistake will not cost them their pay.",
  "Most late arrivals and missed punches are accidental: a train runs late, a child falls ill on the way out, a phone battery dies, or someone simply forgets to tap the button. A workplace that treats every one of these as misconduct tends to lose good people quietly, through resignations, low morale and less willingness to speak up when something is wrong.",
  "A supportive approach does not mean having no rules. It means being clear about the rules, applying them the same way to everyone, and giving people a fair chance to explain. Some practices that help: publish your grace period in writing, give people a simple way to request a correction for a missed punch, review a case before any deduction is applied, and keep a conversation before a penalty for repeated problems.",
  "Deductions are most damaging when they are automatic and disproportionate. Deducting a full day's pay for a delay of a few minutes, or for a punch that was missed by accident, can feel like a penalty for bad luck. Over time, this breeds resentment, makes people hide problems instead of raising them, and pushes the team to leave. Attendance should be measured fairly, and the consequences should match the seriousness of what happened.",
  "Please read the questions below carefully. They ask about the policies your company actually applies today, not the ones you intend to apply. Your answers help us understand how different companies approach these situations, and they are recorded without any personal identifiers. There are no right or wrong answers, and every company's situation is different. Please answer honestly, so the insights are useful for you and for others.",
].join("\n\n");

export interface QuestionOption {
  key: string;
  label: string;
  /** 0 = strictest, 3 = most lenient. */
  weight: 0 | 1 | 2 | 3;
}

export interface Question {
  id: string;
  text: string;
  options: QuestionOption[];
}

export const QUESTIONS: Question[] = [
  {
    id: "accident_late",
    text: "When someone arrives late because of an accident, an emergency or a transport breakdown, what does your company do?",
    options: [
      { key: "excuse_fully", label: "Excuse it. No deduction and no late mark", weight: 3 },
      { key: "excuse_with_reason", label: "Excuse it when the employee gives a reason or proof", weight: 2 },
      { key: "standard_late_mark", label: "Apply the standard late mark as usual", weight: 1 },
      { key: "full_day_deduction", label: "Apply a full-day deduction", weight: 0 },
    ],
  },
  {
    id: "missed_punch",
    text: "How do you handle a forgotten or failed punch (not a late arrival)?",
    options: [
      { key: "correction_request", label: "The employee can request a correction, which a manager reviews", weight: 3 },
      { key: "limited_corrections", label: "A fixed number of corrections is allowed each month", weight: 2 },
      { key: "no_corrections", label: "No corrections. The day is recorded as it stands", weight: 0 },
    ],
  },
  {
    id: "grace_deductions",
    text: "How are attendance deductions applied around the grace period?",
    options: [
      { key: "grace_and_review", label: "Grace minutes apply, and a manager reviews a case before any deduction", weight: 3 },
      { key: "grace_only", label: "Grace minutes apply automatically, with no further review", weight: 1 },
      { key: "strict_no_review", label: "Deductions are strict, with no review and no exceptions", weight: 0 },
    ],
  },
  {
    id: "repeat_issues",
    text: "When attendance problems keep happening, what is the first step?",
    options: [
      { key: "private_coaching", label: "A private conversation to understand the cause and agree a plan", weight: 3 },
      { key: "written_reminder", label: "A written reminder of the policy", weight: 2 },
      { key: "penalty_first", label: "A penalty straight away, without a reminder", weight: 0 },
    ],
  },
];

export type Answers = Record<string, string[]>;

/** Checks the answers: every question needs at least one known option. Returns the cleaned answers or an error. */
export function validateAnswers(input: unknown): { ok: true; answers: Answers } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Answer every question." };
  const raw = input as Record<string, unknown>;
  const answers: Answers = {};
  for (const q of QUESTIONS) {
    const value = raw[q.id];
    if (!Array.isArray(value) || value.length === 0) {
      return { ok: false, error: `Please answer: "${q.text}"` };
    }
    const allowed = new Set(q.options.map((o) => o.key));
    const keys = Array.from(new Set(value.map((v) => String(v))));
    if (keys.some((k) => !allowed.has(k))) return { ok: false, error: `An answer to "${q.text}" is not a valid option.` };
    answers[q.id] = q.options.map((o) => o.key).filter((k) => keys.includes(k)); // stable order
  }
  return { ok: true, answers };
}

/** Leniency of one question: the average weight of the chosen options, scaled to 0-100. */
export function questionLeniency(q: Question, chosen: string[]): number {
  const weights: number[] = q.options.filter((o) => chosen.includes(o.key)).map((o) => o.weight);
  if (weights.length === 0) return 0;
  const avg = weights.reduce((a, b) => a + b, 0) / weights.length;
  return (avg / 3) * 100;
}

/** Overall leniency index, 0-100, rounded. The average of the question scores. */
export function leniencyIndex(answers: Answers): number {
  const scores = QUESTIONS.map((q) => questionLeniency(q, answers[q.id] ?? []));
  return Math.round(scores.reduce((a, b) => a + b, 0) / QUESTIONS.length);
}

/**
 * Which third of the payroll cycle `todayKey` falls in. Cycle bounds are "YYYY-MM-DD".
 * Returns slot 0, 1 or 2 (early, mid, late in the cycle).
 */
export function feedbackSlot(periodStartKey: string, periodEndKey: string, todayKey: string): number {
  if (!isDayKey(periodStartKey) || !isDayKey(periodEndKey) || !isDayKey(todayKey)) return 0;
  const length = Math.max(1, diffDayKeys(periodStartKey, periodEndKey) + 1);
  const dayIndex = Math.min(length - 1, Math.max(0, diffDayKeys(periodStartKey, todayKey)));
  return Math.min(SLOTS_PER_CYCLE - 1, Math.floor((dayIndex * SLOTS_PER_CYCLE) / length));
}

export const SLOT_LABELS = ["Early in the cycle", "Middle of the cycle", "End of the cycle"] as const;

/** Leniency bands used for comparisons across companies. */
export type LeniencyBand = "strict" | "balanced" | "lenient";

export function leniencyBand(index: number): LeniencyBand {
  if (index < 40) return "strict";
  if (index < 70) return "balanced";
  return "lenient";
}

export const BAND_LABELS: Record<LeniencyBand, string> = {
  strict: "Strict (below 40)",
  balanced: "Balanced (40 to 69)",
  lenient: "Lenient (70 and above)",
};
