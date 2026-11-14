// Pure statistics for the platform analytics. No database access, so the rules can be unit-tested.
// Small samples are never presented as findings: correlations need MIN_PAIRS companies, and bands need MIN_GROUP.

import { leniencyBand, type LeniencyBand } from "./feedback.ts";

export const MIN_PAIRS = 5; // companies needed before a correlation is reported
export const MIN_GROUP = 3; // companies needed before a band or group average is reported

export interface CompanyMetrics {
  /** Anonymized label, for example "Company 07". Real names never leave the platform admin's management list. */
  label: string;
  /** Average leniency index of the responses in the window, or null when the company has not responded. */
  leniency: number | null;
  /** Team stability: 100 minus the share of headcount that began notice in the window. */
  stability: number | null;
  /** Share of punches that were on time (present), 0-100. */
  onTimeRate: number | null;
  /** Share of active employees who punched in during the window, 0-100. */
  punchActivity: number | null;
  /** Share of expected feedback prompts that were answered, 0-100. */
  feedbackRate: number | null;
}

export interface Correlation {
  x: string;
  y: string;
  r: number | null;
  n: number;
  /** Plain-language reading, or the reason no reading is given. */
  reading: string;
}

/** Pearson correlation. Null when there are fewer than two points or no variation. */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return Math.max(-1, Math.min(1, num / Math.sqrt(dx * dy)));
}

/** Words for a correlation strength. Deliberately cautious: correlation is not causation. */
export function describeR(r: number | null, n: number): string {
  if (n < MIN_PAIRS) return `Not enough companies yet (${n} of ${MIN_PAIRS} needed).`;
  if (r === null) return "No variation in the data, so no relationship can be measured.";
  const size = Math.abs(r) < 0.1 ? "no clear" : Math.abs(r) < 0.3 ? "a weak" : Math.abs(r) < 0.5 ? "a moderate" : "a strong";
  const dir = r > 0 ? "positive" : r < 0 ? "negative" : "";
  if (size === "no clear") return "No clear relationship in this sample.";
  return `${size[0].toUpperCase()}${size.slice(1)} ${dir} relationship. This shows association only, not cause.`;
}

/** Correlation of two metrics across companies where both are known. */
export function correlate(rows: CompanyMetrics[], xKey: keyof CompanyMetrics, yKey: keyof CompanyMetrics, xName: string, yName: string): Correlation {
  const pairs = rows.filter((r) => typeof r[xKey] === "number" && typeof r[yKey] === "number");
  const xs = pairs.map((r) => r[xKey] as number);
  const ys = pairs.map((r) => r[yKey] as number);
  const r = pairs.length >= MIN_PAIRS ? pearson(xs, ys) : null;
  return { x: xName, y: yName, r: r === null ? null : Math.round(r * 100) / 100, n: pairs.length, reading: describeR(r, pairs.length) };
}

export interface BandSummary {
  band: LeniencyBand;
  companies: number;
  /** Null when fewer than MIN_GROUP companies are in the band, so small groups are not exposed. */
  stability: number | null;
  onTimeRate: number | null;
  punchActivity: number | null;
  feedbackRate: number | null;
}

function mean(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => typeof v === "number");
  if (known.length === 0) return null;
  return Math.round((known.reduce((a, b) => a + b, 0) / known.length) * 10) / 10;
}

/** Companies grouped by leniency band, with averages for each group that is large enough to report. */
export function bandSummaries(rows: CompanyMetrics[]): BandSummary[] {
  const bands: LeniencyBand[] = ["strict", "balanced", "lenient"];
  return bands.map((band) => {
    const members = rows.filter((r) => r.leniency !== null && leniencyBand(r.leniency) === band);
    const reportable = members.length >= MIN_GROUP;
    return {
      band,
      companies: members.length,
      stability: reportable ? mean(members.map((m) => m.stability)) : null,
      onTimeRate: reportable ? mean(members.map((m) => m.onTimeRate)) : null,
      punchActivity: reportable ? mean(members.map((m) => m.punchActivity)) : null,
      feedbackRate: reportable ? mean(members.map((m) => m.feedbackRate)) : null,
    };
  });
}

/** Deterministic anonymized labels: the companies are ordered by id, so a label stays the same between reloads. */
export function anonymizedLabels(ids: string[]): Map<string, string> {
  const sorted = [...ids].sort();
  return new Map(sorted.map((id, i) => [id, `Company ${String(i + 1).padStart(2, "0")}`]));
}
