import { NextResponse } from "next/server";
import { and, count, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminFeedbackResponses, attendance, companies, employees, noticePeriods } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { QUESTIONS, SLOTS_PER_CYCLE, leniencyBand, type Answers } from "@/lib/feedback";
import {
  anonymizedLabels,
  bandSummaries,
  correlate,
  MIN_PAIRS,
  type CompanyMetrics,
} from "@/lib/feedback-analytics";

const DAY = 86400000;
const pct = (n: number, d: number) => (d > 0 ? Math.round(Math.min(100, (n / d) * 1000)) / 10 : null);

/**
 * Platform admin only. Compares companies by how lenient their admins say they are, against team stability,
 * on-time attendance, punch coverage and how consistently they answer the feedback prompt.
 * Companies appear only under anonymized labels. Nothing identifies a company, person or free text.
 */
export async function GET(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const monthsRaw = Number(url.searchParams.get("months") ?? 3);
  const months = [3, 6, 12].includes(monthsRaw) ? monthsRaw : 3;
  const now = new Date();
  const since = new Date(now.getTime() - months * 30 * DAY);
  const sinceDay = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));

  const companyRows = await db
    .select({ id: companies.id, status: companies.status, createdAt: companies.createdAt })
    .from(companies)
    .where(eq(companies.status, "active"));
  const ids = companyRows.map((c) => c.id);
  const labels = anonymizedLabels(ids);

  if (ids.length === 0) {
    return NextResponse.json(emptyPayload(months, since, now));
  }

  // Headcount per company (active employees).
  const headRows = await db
    .select({ companyId: employees.companyId, n: count(employees.id) })
    .from(employees)
    .where(and(inArray(employees.companyId, ids), eq(employees.isActive, true)))
    .groupBy(employees.companyId);
  const headcount = new Map(headRows.map((r) => [r.companyId, Number(r.n)]));

  // Notices that started in the window: a proxy for team turnover.
  const exitRows = await db
    .select({ companyId: noticePeriods.companyId, n: count(noticePeriods.id) })
    .from(noticePeriods)
    .where(and(inArray(noticePeriods.companyId, ids), inArray(noticePeriods.status, ["active", "completed"]), gte(noticePeriods.requestedAt, since)))
    .groupBy(noticePeriods.companyId);
  const exits = new Map(exitRows.map((r) => [r.companyId, Number(r.n)]));

  // Punch outcomes in the window.
  const statusRows = await db
    .select({ companyId: attendance.companyId, status: attendance.status, n: sql<number>`count(*)::int` })
    .from(attendance)
    .where(and(inArray(attendance.companyId, ids), gte(attendance.workDate, sinceDay), isNotNull(attendance.punchInTime)))
    .groupBy(attendance.companyId, attendance.status);
  const punchOutcome = new Map<string, { onTime: number; total: number; rows: number }>();
  for (const r of statusRows) {
    const cur = punchOutcome.get(r.companyId) ?? { onTime: 0, total: 0, rows: 0 };
    const n = Number(r.n);
    cur.rows += n;
    if (["present", "late", "half_day"].includes(r.status)) cur.total += n;
    if (r.status === "present") cur.onTime += n;
    punchOutcome.set(r.companyId, cur);
  }

  // Feedback responses in the window.
  const responses = await db
    .select({
      companyId: adminFeedbackResponses.companyId,
      cycleKey: adminFeedbackResponses.cycleKey,
      leniencyIndex: adminFeedbackResponses.leniencyIndex,
      answers: adminFeedbackResponses.answers,
    })
    .from(adminFeedbackResponses)
    .where(and(inArray(adminFeedbackResponses.companyId, ids), gte(adminFeedbackResponses.respondedAt, since)));

  const byCompany = new Map<string, { sum: number; n: number }>();
  const byCycle = new Map<string, { sum: number; n: number }>();
  const optionCounts: Record<string, Record<string, number>> = {};
  for (const r of responses) {
    const c = byCompany.get(r.companyId) ?? { sum: 0, n: 0 };
    c.sum += r.leniencyIndex;
    c.n += 1;
    byCompany.set(r.companyId, c);
    const cy = byCycle.get(r.cycleKey) ?? { sum: 0, n: 0 };
    cy.sum += r.leniencyIndex;
    cy.n += 1;
    byCycle.set(r.cycleKey, cy);
    const answers = r.answers as Answers;
    for (const q of QUESTIONS) {
      optionCounts[q.id] ??= {};
      for (const key of answers[q.id] ?? []) optionCounts[q.id][key] = (optionCounts[q.id][key] ?? 0) + 1;
    }
  }

  const windowDays = months * 30;
  // A company can only be expected to answer prompts since it was created (at most `months` months).
  const expectedPrompts = new Map(
    companyRows.map((c) => {
      const monthsSinceCreated = Math.max(1, Math.ceil((now.getTime() - c.createdAt.getTime()) / (30 * DAY)));
      return [c.id, SLOTS_PER_CYCLE * Math.min(months, monthsSinceCreated)] as const;
    })
  );
  const rows: CompanyMetrics[] = companyRows.map((c) => {
    const head = headcount.get(c.id) ?? 0;
    const out = punchOutcome.get(c.id);
    const fb = byCompany.get(c.id);
    return {
      label: labels.get(c.id) ?? "Company",
      leniency: fb ? Math.round(fb.sum / fb.n) : null,
      stability: head > 0 ? Math.max(0, Math.min(100, Math.round((100 - ((exits.get(c.id) ?? 0) / head) * 100) * 10) / 10)) : null,
      onTimeRate: out && out.total > 0 ? pct(out.onTime, out.total) : null,
      // Approximate: punch rows against the working days expected from active headcount (about a six-day week).
      punchActivity: head > 0 && out ? pct(out.rows, head * windowDays * (6 / 7)) : null,
      feedbackRate: pct(fb?.n ?? 0, expectedPrompts.get(c.id) ?? 0),
    };
  });

  const responding = rows.filter((r) => r.leniency !== null).length;
  const allLeniency = responses.map((r) => r.leniencyIndex);

  const correlations = [
    correlate(rows, "leniency", "stability", "Leniency", "Team stability"),
    correlate(rows, "leniency", "onTimeRate", "Leniency", "On-time rate"),
    correlate(rows, "leniency", "punchActivity", "Leniency", "Punch coverage"),
    correlate(rows, "leniency", "feedbackRate", "Leniency", "Feedback engagement"),
  ];

  // Companies with leniency values are plotted; the list carries no names.
  const scatter = rows
    .filter((r) => r.leniency !== null && r.stability !== null)
    .map((r) => ({ label: r.label, leniency: r.leniency, stability: r.stability }));

  return NextResponse.json({
    window: { months, from: since.toISOString(), to: now.toISOString() },
    thresholds: { minPairs: MIN_PAIRS, minGroup: 3 },
    platform: {
      activeCompanies: rows.length,
      respondingCompanies: responding,
      responses: responses.length,
      responseRate: pct(responses.length, [...expectedPrompts.values()].reduce((a, b) => a + b, 0)),
      averageLeniency: allLeniency.length ? Math.round(allLeniency.reduce((a, b) => a + b, 0) / allLeniency.length) : null,
    },
    companies: rows.map((r) => ({ ...r, band: r.leniency === null ? null : leniencyBand(r.leniency) })),
    scatter,
    correlations,
    bands: bandSummaries(rows),
    trend: [...byCycle.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([cycleKey, v]) => ({ cycleKey, averageLeniency: Math.round(v.sum / v.n), responses: v.n })),
    questions: QUESTIONS.map((q) => {
      const total = responses.length;
      return {
        id: q.id,
        text: q.text,
        options: q.options.map((o) => ({
          key: o.key,
          label: o.label,
          weight: o.weight,
          share: total > 0 ? Math.round(((optionCounts[q.id]?.[o.key] ?? 0) / total) * 1000) / 10 : 0,
        })),
      };
    }),
  });
}

function emptyPayload(months: number, since: Date, now: Date) {
  return {
    window: { months, from: since.toISOString(), to: now.toISOString() },
    thresholds: { minPairs: MIN_PAIRS, minGroup: 3 },
    platform: { activeCompanies: 0, respondingCompanies: 0, responses: 0, responseRate: null, averageLeniency: null },
    companies: [],
    scatter: [],
    correlations: [],
    bands: [],
    trend: [],
    questions: QUESTIONS.map((q) => ({ id: q.id, text: q.text, options: q.options.map((o) => ({ ...o, share: 0 })) })),
  };
}
