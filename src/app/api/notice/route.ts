import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, employees, noticePeriods, users } from "@/db/schema";
import type { NoticePeriod } from "@/db/schema";
import { getAuth, type AuthContext } from "@/lib/auth";
import { dateKey, localWorkDate } from "@/lib/payroll";
import {
  isDayKey,
  lastWorkingDayOf,
  noticePhase,
  OPEN_NOTICE_STATUSES,
  signatureMatches,
  validNoticeDays,
  type NoticePhase,
} from "@/lib/notice";

const MAX_TEXT = 1000;
const UUID_RE = /^[0-9a-f-]{36}$/i;

/** The company's notice policy, with safe defaults for a company that has no settings row yet. */
function policyOf(ctx: AuthContext) {
  const s = ctx.settings;
  return {
    enabled: s?.noticeEnabled ?? true,
    defaultDays: s?.noticeDefaultDays ?? 30,
    maxDays: s?.noticeMaxDays ?? 90,
    allowEarlyRelease: s?.noticeAllowEarlyRelease ?? true,
  };
}

interface NoticeView {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  status: string;
  source: string;
  reason: string | null;
  resignationConfirmed: boolean;
  signedName: string | null;
  signedAt: string | null;
  requestedAt: string;
  startDate: string | null;
  noticeDays: number | null;
  lastWorkingDay: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  completedAt: string | null;
  phase: NoticePhase | null;
  daysLeft: number | null;
}

function view(n: NoticePeriod, who: { name: string; code: string | null }, todayKey: string): NoticeView {
  const startKey = n.startDate ? dateKey(n.startDate) : null;
  const lastKey = n.lastWorkingDay ? dateKey(n.lastWorkingDay) : null;
  let phase: NoticePhase | null = null;
  let daysLeft: number | null = null;
  if (n.status === "active" && startKey && lastKey) {
    const p = noticePhase(startKey, lastKey, todayKey);
    phase = p.phase;
    daysLeft = p.daysLeft;
  } else if (n.status === "completed") {
    phase = "ended";
    daysLeft = 0;
  }
  return {
    id: n.id,
    employeeId: n.employeeId,
    employeeName: who.name,
    employeeCode: who.code,
    status: n.status,
    source: n.source,
    reason: n.reason,
    resignationConfirmed: n.resignationConfirmed,
    signedName: n.signedName,
    signedAt: n.signedAt?.toISOString() ?? null,
    requestedAt: n.requestedAt.toISOString(),
    startDate: startKey,
    noticeDays: n.noticeDays,
    lastWorkingDay: lastKey,
    decidedAt: n.decidedAt?.toISOString() ?? null,
    decisionNote: n.decisionNote,
    completedAt: n.completedAt?.toISOString() ?? null,
    phase,
    daysLeft,
  };
}

const isOpen = (status: string) => (OPEN_NOTICE_STATUSES as string[]).includes(status);

/**
 * Employee: their notice (current and past). Admin: pending requests, active notices, history and the staff list
 * for placing someone on notice directly.
 */
export async function GET() {
  const ctx = await getAuth();
  if (!ctx || !ctx.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const companyId = ctx.company.id;
  const tz = ctx.settings?.timezone || "UTC";
  const todayKey = dateKey(localWorkDate(new Date(), tz));
  const policy = policyOf(ctx);

  if (ctx.user.role === "employee" && ctx.employee) {
    const rows = await db
      .select()
      .from(noticePeriods)
      .where(and(eq(noticePeriods.employeeId, ctx.employee.id), eq(noticePeriods.companyId, companyId)))
      .orderBy(desc(noticePeriods.requestedAt))
      .limit(20);
    const who = { name: ctx.user.fullName, code: ctx.employee.employeeCode };
    const history = rows.map((r) => view(r, who, todayKey));
    const current = history.find((h) => isOpen(h.status)) ?? null;
    return NextResponse.json({
      role: "employee",
      todayKey,
      policy,
      signerName: ctx.user.fullName,
      current,
      history,
      canRequest: policy.enabled && !current,
    });
  }

  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = await db
    .select({ notice: noticePeriods, name: users.fullName, code: employees.employeeCode })
    .from(noticePeriods)
    .innerJoin(employees, eq(noticePeriods.employeeId, employees.id))
    .innerJoin(users, eq(employees.userId, users.id))
    .where(eq(noticePeriods.companyId, companyId))
    .orderBy(desc(noticePeriods.requestedAt))
    .limit(300);
  const all = rows.map((r) => view(r.notice, { name: r.name, code: r.code }, todayKey));

  const staffRows = await db
    .select({ id: employees.id, name: users.fullName, code: employees.employeeCode })
    .from(employees)
    .innerJoin(users, eq(employees.userId, users.id))
    .where(and(eq(employees.companyId, companyId), eq(employees.isActive, true), eq(users.role, "employee")))
    .orderBy(users.fullName);
  const onNotice = new Set(all.filter((v) => isOpen(v.status)).map((v) => v.employeeId));

  return NextResponse.json({
    role: "company_admin",
    todayKey,
    policy,
    requests: all.filter((v) => v.status === "requested"),
    active: all.filter((v) => v.status === "active"),
    history: all.filter((v) => !isOpen(v.status)).slice(0, 60),
    staff: staffRows.map((s) => ({ id: s.id, name: s.name, code: s.code, onNotice: onNotice.has(s.id) })),
  });
}

export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx || !ctx.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const companyId = ctx.company.id;
  const tz = ctx.settings?.timezone || "UTC";
  const now = new Date();
  const todayKey = dateKey(localWorkDate(now, tz));
  const policy = policyOf(ctx);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const action = String(body.action || "");
  const text = (v: unknown) => String(v ?? "").trim().slice(0, MAX_TEXT) || null;

  // ------------------------------------------------------------ employee
  if (action === "request") {
    if (ctx.user.role !== "employee" || !ctx.employee) {
      return NextResponse.json({ error: "Only employees can request a notice period." }, { status: 403 });
    }
    if (!policy.enabled) return NextResponse.json({ error: "Notice requests are switched off for your company." }, { status: 400 });
    if (body.confirmed !== true) {
      return NextResponse.json({ error: "Confirm that you have sent your formal resignation email." }, { status: 400 });
    }
    if (!signatureMatches(body.signature, ctx.user.fullName)) {
      return NextResponse.json(
        { error: `To sign, type your full name exactly as it is on your account: ${ctx.user.fullName}.` },
        { status: 400 }
      );
    }
    const open = await db
      .select({ id: noticePeriods.id })
      .from(noticePeriods)
      .where(and(eq(noticePeriods.employeeId, ctx.employee.id), inArray(noticePeriods.status, OPEN_NOTICE_STATUSES)))
      .limit(1);
    if (open.length > 0) {
      return NextResponse.json({ error: "You already have a notice request or an active notice period." }, { status: 400 });
    }

    let created: { id: string }[];
    try {
      created = await db
        .insert(noticePeriods)
        .values({
          companyId,
          employeeId: ctx.employee.id,
          status: "requested",
          source: "employee",
          reason: text(body.reason),
          resignationConfirmed: true,
          signedName: String(body.signature).trim().slice(0, 200),
          signedAt: now,
          requestedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: noticePeriods.id });
    } catch {
      return NextResponse.json({ error: "You already have a notice request or an active notice period." }, { status: 409 });
    }
    await audit(companyId, ctx.user.id, "notice.request", created[0].id, { employeeId: ctx.employee.id });
    return NextResponse.json({ ok: true, id: created[0].id });
  }

  if (action === "withdraw") {
    if (ctx.user.role !== "employee" || !ctx.employee) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const id = String(body.noticeId || "");
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Request not found." }, { status: 404 });
    const [n] = await db
      .select()
      .from(noticePeriods)
      .where(and(eq(noticePeriods.id, id), eq(noticePeriods.employeeId, ctx.employee.id)))
      .limit(1);
    if (!n) return NextResponse.json({ error: "Request not found." }, { status: 404 });
    if (n.status !== "requested") return NextResponse.json({ error: "Only a request that is still waiting can be withdrawn." }, { status: 400 });
    await db
      .update(noticePeriods)
      .set({ status: "cancelled", decisionNote: "Withdrawn by the employee", updatedAt: now })
      .where(eq(noticePeriods.id, id));
    await audit(companyId, ctx.user.id, "notice.withdraw", id, {});
    return NextResponse.json({ ok: true });
  }

  // ------------------------------------------------------------ admin
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Only the company admin can manage notice periods." }, { status: 403 });

  if (action === "place") {
    const employeeId = String(body.employeeId || "");
    if (!UUID_RE.test(employeeId)) return NextResponse.json({ error: "Choose an employee." }, { status: 400 });
    const [emp] = await db
      .select({ id: employees.id, name: users.fullName, code: employees.employeeCode, role: users.role, isActive: employees.isActive })
      .from(employees)
      .innerJoin(users, eq(employees.userId, users.id))
      .where(and(eq(employees.id, employeeId), eq(employees.companyId, companyId)))
      .limit(1);
    if (!emp || emp.role !== "employee") return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    if (!emp.isActive) return NextResponse.json({ error: "This employee is inactive." }, { status: 400 });

    const days = validNoticeDays(body.days, policy.maxDays);
    if (days === null) return NextResponse.json({ error: `Enter a whole number of days from 1 to ${policy.maxDays}.` }, { status: 400 });
    const startKey = isDayKey(body.startDate) ? body.startDate : todayKey;
    const lastKey = lastWorkingDayOf(startKey, days);

    try {
      const created = await db
        .insert(noticePeriods)
        .values({
          companyId,
          employeeId,
          status: "active",
          source: "admin",
          reason: text(body.reason),
          resignationConfirmed: false,
          requestedAt: now,
          startDate: new Date(`${startKey}T00:00:00Z`),
          noticeDays: days,
          lastWorkingDay: new Date(`${lastKey}T00:00:00Z`),
          decidedAt: now,
          decidedBy: ctx.user.id,
          decisionNote: text(body.note),
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: noticePeriods.id });
      await audit(companyId, ctx.user.id, "notice.place", created[0].id, { employeeId, days, startDate: startKey });
      return NextResponse.json({ ok: true, id: created[0].id });
    } catch {
      return NextResponse.json({ error: `${emp.name} is already on notice or has a request waiting.` }, { status: 409 });
    }
  }

  const id = String(body.noticeId || "");
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  const [n] = await db
    .select()
    .from(noticePeriods)
    .where(and(eq(noticePeriods.id, id), eq(noticePeriods.companyId, companyId)))
    .limit(1);
  if (!n) return NextResponse.json({ error: "Request not found." }, { status: 404 });

  if (action === "approve") {
    if (n.status !== "requested") return NextResponse.json({ error: "This request has already been decided." }, { status: 400 });
    const days = validNoticeDays(body.days, policy.maxDays);
    if (days === null) return NextResponse.json({ error: `Enter a whole number of days from 1 to ${policy.maxDays}.` }, { status: 400 });
    const startKey = isDayKey(body.startDate) ? body.startDate : todayKey;
    const lastKey = lastWorkingDayOf(startKey, days);
    await db
      .update(noticePeriods)
      .set({
        status: "active",
        noticeDays: days,
        startDate: new Date(`${startKey}T00:00:00Z`),
        lastWorkingDay: new Date(`${lastKey}T00:00:00Z`),
        decidedAt: now,
        decidedBy: ctx.user.id,
        decisionNote: text(body.note),
        updatedAt: now,
      })
      .where(eq(noticePeriods.id, id));
    await audit(companyId, ctx.user.id, "notice.approve", id, { days, startDate: startKey, lastWorkingDay: lastKey });
    return NextResponse.json({ ok: true, lastWorkingDay: lastKey });
  }

  if (action === "reject") {
    if (n.status !== "requested") return NextResponse.json({ error: "This request has already been decided." }, { status: 400 });
    await db
      .update(noticePeriods)
      .set({ status: "rejected", decidedAt: now, decidedBy: ctx.user.id, decisionNote: text(body.note), updatedAt: now })
      .where(eq(noticePeriods.id, id));
    await audit(companyId, ctx.user.id, "notice.reject", id, {});
    return NextResponse.json({ ok: true });
  }

  if (action === "complete") {
    if (n.status !== "active") return NextResponse.json({ error: "Only a notice period that is being served can be completed." }, { status: 400 });
    await db
      .update(noticePeriods)
      .set({ status: "completed", completedAt: now, updatedAt: now })
      .where(eq(noticePeriods.id, id));
    await audit(companyId, ctx.user.id, "notice.complete", id, {});
    return NextResponse.json({ ok: true });
  }

  if (action === "cancel") {
    if (!isOpen(n.status)) return NextResponse.json({ error: "This notice is already closed." }, { status: 400 });
    await db
      .update(noticePeriods)
      .set({ status: "cancelled", decidedAt: now, decidedBy: ctx.user.id, decisionNote: text(body.note), updatedAt: now })
      .where(eq(noticePeriods.id, id));
    await audit(companyId, ctx.user.id, "notice.cancel", id, {});
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

async function audit(companyId: string, actorId: string, action: string, entityId: string, details: Record<string, unknown>) {
  await db.insert(auditLogs).values({ companyId, actorId, action, entity: "notice", entityId, details });
}
