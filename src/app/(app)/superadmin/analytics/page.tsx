"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Badge, Card, EmptyState, PageHeader, Spinner, StatCard } from "@/components/ui";

interface CompanyRow {
  label: string;
  leniency: number | null;
  stability: number | null;
  onTimeRate: number | null;
  punchActivity: number | null;
  feedbackRate: number | null;
  band: "strict" | "balanced" | "lenient" | null;
}

interface Analytics {
  window: { months: number; from: string; to: string };
  thresholds: { minPairs: number; minGroup: number };
  platform: {
    activeCompanies: number;
    respondingCompanies: number;
    responses: number;
    responseRate: number | null;
    averageLeniency: number | null;
  };
  companies: CompanyRow[];
  scatter: { label: string; leniency: number; stability: number }[];
  correlations: { x: string; y: string; r: number | null; n: number; reading: string }[];
  bands: {
    band: "strict" | "balanced" | "lenient";
    companies: number;
    stability: number | null;
    onTimeRate: number | null;
    punchActivity: number | null;
    feedbackRate: number | null;
  }[];
  trend: { cycleKey: string; averageLeniency: number; responses: number }[];
  questions: { id: string; text: string; options: { key: string; label: string; weight: number; share: number }[] }[];
}

const BAND_NAME: Record<"strict" | "balanced" | "lenient", string> = {
  strict: "Strict (below 40)",
  balanced: "Balanced (40 to 69)",
  lenient: "Lenient (70+)",
};

const fmt = (v: number | null, suffix = "%") => (v === null ? "—" : `${v}${suffix}`);

export default function PlatformAnalyticsPage() {
  const [months, setMonths] = useState(3);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api<Analytics>(`/api/superadmin/analytics?months=${months}`)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load analytics");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [months]);

  return (
    <div>
      <PageHeader
        title="Platform analytics"
        subtitle="How leniency in attendance rules relates to team stability and engagement. Companies are anonymized."
        action={
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            {[3, 6, 12].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMonths(m)}
                className={
                  months === m
                    ? "rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-indigo-700 shadow-sm"
                    : "rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800"
                }
              >
                {m} months
              </button>
            ))}
          </div>
        }
      />

      {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
      {loading && !data ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : !data ? null : (
        <div className="space-y-5">
          <Card className="border-amber-200 bg-amber-50/60 p-4">
            <p className="text-sm text-amber-900">
              <span className="font-bold">Read these as associations, not causes.</span> Correlations are only shown for at least{" "}
              {data.thresholds.minPairs} companies, and group averages only for at least {data.thresholds.minGroup} companies in a group, so no single company can be identified.
            </p>
          </Card>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="Active companies" value={data.platform.activeCompanies} tone="indigo" />
            <StatCard label="Companies responding" value={data.platform.respondingCompanies} tone="emerald" />
            <StatCard label="Check-ins received" value={data.platform.responses} tone="sky" />
            <StatCard label="Response rate" value={fmt(data.platform.responseRate)} tone="amber" />
            <StatCard label="Average leniency" value={data.platform.averageLeniency === null ? "—" : `${data.platform.averageLeniency}/100`} tone="indigo" />
          </div>

          {data.companies.length === 0 ? (
            <EmptyState message="No active companies yet." />
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                {data.correlations.map((c) => (
                  <Card key={c.y} className="p-5">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                      {c.x} vs {c.y}
                    </p>
                    <div className="mt-1 flex items-baseline gap-3">
                      <p className="text-3xl font-bold text-slate-900">{c.r === null ? "—" : c.r.toFixed(2)}</p>
                      <span className="text-xs text-slate-500">correlation (r) · {c.n} companies</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">{c.reading}</p>
                  </Card>
                ))}
              </div>

              <Card className="p-5">
                <h3 className="font-bold text-slate-900">Leniency against team stability</h3>
                <p className="mb-3 text-xs text-slate-500">
                  Each point is one company. Further right is more lenient. Higher is more stable (fewer people starting notice).
                </p>
                <Scatter points={data.scatter} />
              </Card>

              <div className="grid gap-5 lg:grid-cols-2">
                <Card className="p-5">
                  <h3 className="font-bold text-slate-900">Comparison by leniency band</h3>
                  <p className="mb-3 text-xs text-slate-500">Averages per group. A group with fewer than {data.thresholds.minGroup} companies is hidden.</p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wide text-slate-400">
                          <th className="py-2 pr-2">Band</th>
                          <th className="py-2 pr-2">Companies</th>
                          <th className="py-2 pr-2">Stability</th>
                          <th className="py-2 pr-2">On time</th>
                          <th className="py-2">Feedback</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.bands.map((b) => (
                          <tr key={b.band}>
                            <td className="py-2.5 pr-2 font-semibold text-slate-800">{BAND_NAME[b.band]}</td>
                            <td className="py-2.5 pr-2 text-slate-600">{b.companies}</td>
                            <td className="py-2.5 pr-2 text-slate-600">{b.companies >= data.thresholds.minGroup ? fmt(b.stability) : <Hidden />}</td>
                            <td className="py-2.5 pr-2 text-slate-600">{b.companies >= data.thresholds.minGroup ? fmt(b.onTimeRate) : <Hidden />}</td>
                            <td className="py-2.5 text-slate-600">{b.companies >= data.thresholds.minGroup ? fmt(b.feedbackRate) : <Hidden />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <Card className="p-5">
                  <h3 className="font-bold text-slate-900">Average leniency over time</h3>
                  <p className="mb-3 text-xs text-slate-500">Platform-wide, per payroll cycle.</p>
                  <Trend points={data.trend} />
                </Card>
              </div>

              <Card className="p-5">
                <h3 className="font-bold text-slate-900">What companies say they do</h3>
                <p className="mb-4 text-xs text-slate-500">Share of check-ins that ticked each option in the window.</p>
                <div className="grid gap-5 md:grid-cols-2">
                  {data.questions.map((q) => (
                    <div key={q.id}>
                      <p className="text-sm font-bold text-slate-800">{q.text}</p>
                      <div className="mt-2 space-y-2">
                        {q.options.map((o) => (
                          <div key={o.key}>
                            <div className="flex justify-between gap-2 text-xs text-slate-600">
                              <span className="min-w-0">{o.label}</span>
                              <span className="shrink-0 font-semibold">{o.share}%</span>
                            </div>
                            <div className="mt-1 h-2 rounded-full bg-slate-100">
                              <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${Math.min(100, o.share)}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="overflow-hidden p-0">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h3 className="font-bold text-slate-900">Companies (anonymized)</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Company</th>
                        <th className="px-4 py-3">Leniency</th>
                        <th className="px-4 py-3">Band</th>
                        <th className="px-4 py-3">Stability</th>
                        <th className="px-4 py-3">On time</th>
                        <th className="px-4 py-3">Punch coverage</th>
                        <th className="px-4 py-3">Feedback</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {data.companies.map((c) => (
                        <tr key={c.label} className="hover:bg-slate-50/60">
                          <td className="px-4 py-2.5 font-semibold text-slate-800">{c.label}</td>
                          <td className="px-4 py-2.5 text-slate-700">{c.leniency === null ? "No check-in" : `${c.leniency}/100`}</td>
                          <td className="px-4 py-2.5">
                            {c.band ? (
                              <Badge tone={c.band === "strict" ? "red" : c.band === "lenient" ? "green" : "amber"}>{c.band}</Badge>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{fmt(c.stability)}</td>
                          <td className="px-4 py-2.5 text-slate-600">{fmt(c.onTimeRate)}</td>
                          <td className="px-4 py-2.5 text-slate-600">{fmt(c.punchActivity)}</td>
                          <td className="px-4 py-2.5 text-slate-600">{fmt(c.feedbackRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400">
                  Stability: 100 minus the share of headcount that started notice in the window. Punch coverage is approximate: punches against the working days expected from headcount (six-day week).
                </p>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Hidden() {
  return <span className="text-xs text-slate-400">hidden (small group)</span>;
}

/** Leniency (x, 0-100) against stability (y, 0-100). Plain SVG so no charting dependency is needed. */
function Scatter({ points }: { points: { label: string; leniency: number; stability: number }[] }) {
  const W = 560;
  const H = 300;
  const P = 44;
  const x = (v: number) => P + (v / 100) * (W - P * 2);
  const y = (v: number) => H - P - (v / 100) * (H - P * 2);
  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-400">No check-ins in this window yet.</p>;
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Scatter plot of leniency against stability">
      {[0, 25, 50, 75, 100].map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={P} y2={H - P} stroke="#e2e8f0" />
          <line x1={P} x2={W - P} y1={y(t)} y2={y(t)} stroke="#e2e8f0" />
          <text x={x(t)} y={H - P + 16} textAnchor="middle" fontSize="10" fill="#94a3b8">{t}</text>
          <text x={P - 8} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{t}</text>
        </g>
      ))}
      <text x={W / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="#64748b">Leniency →</text>
      <text x={12} y={H / 2} fontSize="11" fill="#64748b" transform={`rotate(-90 12 ${H / 2})`} textAnchor="middle">Stability →</text>
      {points.map((p) => (
        <g key={p.label}>
          <circle cx={x(p.leniency)} cy={y(p.stability)} r={6} fill="#6366f1" fillOpacity={0.8} />
          <text x={x(p.leniency) + 9} y={y(p.stability) + 4} fontSize="10" fill="#334155">{p.label}</text>
        </g>
      ))}
    </svg>
  );
}

/** Platform average leniency per cycle. */
function Trend({ points }: { points: { cycleKey: string; averageLeniency: number; responses: number }[] }) {
  if (points.length === 0) return <p className="py-10 text-center text-sm text-slate-400">No check-ins in this window yet.</p>;
  const W = 560;
  const H = 200;
  const P = 36;
  const step = points.length > 1 ? (W - P * 2) / (points.length - 1) : 0;
  const x = (i: number) => (points.length > 1 ? P + i * step : W / 2);
  const y = (v: number) => H - P - (v / 100) * (H - P * 2);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.averageLeniency)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Average leniency per cycle">
      {[0, 50, 100].map((t) => (
        <g key={t}>
          <line x1={P} x2={W - P} y1={y(t)} y2={y(t)} stroke="#e2e8f0" />
          <text x={P - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{t}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="#6366f1" strokeWidth={2.5} />
      {points.map((p, i) => (
        <g key={p.cycleKey}>
          <circle cx={x(i)} cy={y(p.averageLeniency)} r={4} fill="#6366f1" />
          <text x={x(i)} y={H - 10} textAnchor="middle" fontSize="10" fill="#64748b">{p.cycleKey}</text>
        </g>
      ))}
    </svg>
  );
}
