import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, employees, salaryRecords, salarySlipRequests, users } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { addDays, currentCycleKey, dateKey, localWorkDate, SLIP_ACCESS_DAYS } from "@/lib/payroll";
import { computeMonth } from "@/lib/salary";
import { breakdownOf } from "@/lib/salary-breakdown";
import type { SlipSnapshot } from "@/lib/slip-snapshot";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_REJECTION_REASON = 300;

function availability(status: string, availableUntil: Date | null, now: Date) {
  const available = status === "approved" && !!availableUntil && now.getTime() < availableUntil.getTime();
  return { available, expired: status === "approved" && !!availableUntil && !available };
}

/**
 * Admin: every request for the company (pending first). Employee: their own requests.
 * Slip data itself is served by /api/salary/slips/[id], which enforces the 90-day window.
 */
export async function GET(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role === "super_admin" || !ctx.company) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const companyId = ctx.company.id;
  const now = new Date();
  const runningKey = runningCycle(ctx);

  if (ctx.user.role === "company_admin") {
    const status = new URL(req.url).searchParams.get("status") === "all" ? null : "pending";
    const rows = await db
      .select({ req: salarySlipRequests, employeeName: users.fullName, employeeCode: employees.employeeCode, designation: employees.designation })
      .from(salarySlipRequests)
      .innerJoin(employees, eq(salarySlipRequests.employeeId, employees.id))
      .innerJoin(users, eq(employees.userId, users.id))
      .where(and(eq(salarySlipRequests.companyId, companyId), status ? eq(salarySlipRequests.status, status) : undefined))
      .orderBy(desc(salarySlipRequests.requestedAt))
      .limit(200);
    return NextResponse.json({
      requests: rows.map((r) => ({
        id: r.req.id,
        employeeId: r.req.employeeId,
        employeeName: r.employeeName,
        employeeCode: r.employeeCode,
        designation: r.designation,
        year: r.req.year,
        month: r.req.month,
        status: r.req.status,
        requestedAt: r.req.requestedAt,
        decidedAt: r.req.decidedAt,
        rejectionReason: r.req.rejectionReason,
        availableUntil: r.req.availableUntil,
        runningCycle: runningKey.year === r.req.year && runningKey.month === r.req.month,
      })),
    });
  }

  if (!ctx.employee) return NextResponse.json({ error: "Employee profile not found." }, { status: 400 });
  const rows = await db
    .select()
    .from(salarySlipRequests)
    .where(eq(salarySlipRequests.employeeId, ctx.employee.id))
    .orderBy(desc(salarySlipRequests.year), desc(salarySlipRequests.month))
    .limit(24);
  return NextResponse.json({
    requests: rows.map((r) => ({
      id: r.id,
      year: r.year,
      month: r.month,
      status: r.status,
      provisional: r.provisional,
      requestedAt: r.requestedAt,
      decidedAt: r.decidedAt,
      rejectionReason: r.rejectionReason,
      availableUntil: r.availableUntil,
      ...availability(r.status, r.availableUntil, now),
    })),
    // The cycle that is still running, and whether employees may ask for a slip for it now.
    currentCycle: {
      year: runningKey.year,
      month: runningKey.month,
      midCycleAllowed: !!ctx.settings?.midCycleSlipEnabled,
    },
  });
}

export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.company) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const companyId = ctx.company.id;
  const now = new Date();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const action = String(body.action || "");

  // ---- Employee: ask for the slip of a finalized cycle
  if (action === "request") {
    if (ctx.user.role !== "employee" || !ctx.employee) {
      return NextResponse.json({ error: "Only employees can request salary slips." }, { status: 403 });
    }
    const month = String(body.month || "");
    if (!MONTH_RE.test(month)) return NextResponse.json({ error: "Choose a valid salary cycle." }, { status: 400 });
    const year = Number(month.slice(0, 4));
    const cycle = Number(month.slice(5, 7));

    const [record] = await db
      .select({ status: salaryRecords.status })
      .from(salaryRecords)
      .where(
        and(
          eq(salaryRecords.employeeId, ctx.employee.id),
          eq(salaryRecords.year, year),
          eq(salaryRecords.month, cycle),
          inArray(salaryRecords.status, ["finalized", "paid"])
        )
      )
      .limit(1);
    // A cycle that is still running can be requested only when the company allows mid-cycle slips.
    const running = runningCycle(ctx);
    const isRunning = running.year === year && running.month === cycle;
    if (!record && !(isRunning && ctx.settings?.midCycleSlipEnabled)) {
      return NextResponse.json(
        {
          error: isRunning
            ? "Slips for the running salary cycle are switched off. Ask your admin, or wait until the cycle is finalized."
            : "This salary is not finalized yet, so a slip is not available to request.",
        },
        { status: 400 }
      );
    }

    const [existing] = await db
      .select()
      .from(salarySlipRequests)
      .where(and(eq(salarySlipRequests.employeeId, ctx.employee.id), eq(salarySlipRequests.year, year), eq(salarySlipRequests.month, cycle)))
      .limit(1);
    if (existing?.status === "approved" && existing.availableUntil && now < existing.availableUntil) {
      return NextResponse.json({ error: "This slip is already approved and ready to download." }, { status: 400 });
    }
    if (existing?.status === "pending") return NextResponse.json({ ok: true, status: "pending" });

    await db
      .insert(salarySlipRequests)
      .values({ companyId, employeeId: ctx.employee.id, year, month: cycle, status: "pending", requestedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [salarySlipRequests.employeeId, salarySlipRequests.year, salarySlipRequests.month],
        set: {
          status: "pending",
          requestedAt: now,
          decidedAt: null,
          decidedBy: null,
          rejectionReason: null,
          availableUntil: null,
          updatedAt: now,
        },
      });
    return NextResponse.json({ ok: true, status: "pending" });
  }

  // ---- Admin: approve or reject a request
  if (action === "approve" || action === "reject") {
    if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Only company admins can decide slip requests." }, { status: 403 });
    const requestId = String(body.requestId || "");
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) return NextResponse.json({ error: "Request not found." }, { status: 404 });

    const [request] = await db
      .select()
      .from(salarySlipRequests)
      .where(and(eq(salarySlipRequests.id, requestId), eq(salarySlipRequests.companyId, companyId)))
      .limit(1);
    if (!request) return NextResponse.json({ error: "Request not found." }, { status: 404 });
    if (request.status !== "pending") return NextResponse.json({ error: "This request has already been decided." }, { status: 400 });

    if (action === "approve") {
      // A cycle that is still open gets a provisional slip: its figures are frozen at approval.
      const c = await computeMonth(companyId, request.employeeId, request.year, request.month);
      const snapshot = c.frozen ? null : buildSnapshot(c, now, ctx.settings?.timezone || "UTC");
      await db
        .update(salarySlipRequests)
        .set({
          status: "approved",
          decidedAt: now,
          decidedBy: ctx.user.id,
          rejectionReason: null,
          availableUntil: addDays(now, SLIP_ACCESS_DAYS),
          provisional: !c.frozen,
          snapshot: snapshot as unknown as Record<string, unknown> | null,
          updatedAt: now,
        })
        .where(eq(salarySlipRequests.id, request.id));
    } else {
      const reason = String(body.reason || "").trim().slice(0, MAX_REJECTION_REASON) || null;
      await db
        .update(salarySlipRequests)
        .set({ status: "rejected", decidedAt: now, decidedBy: ctx.user.id, rejectionReason: reason, availableUntil: null, updatedAt: now })
        .where(eq(salarySlipRequests.id, request.id));
    }

    await db.insert(auditLogs).values({
      companyId,
      actorId: ctx.user.id,
      action: `salary_slip.${action}`,
      entity: "salary_slip_request",
      entityId: request.id,
      details: { employeeId: request.employeeId, year: request.year, month: request.month },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

/** The company's running salary cycle (the one that contains today), in company time. */
function runningCycle(ctx: { settings: { timezone: string; salaryCycleStartDay: number } | null }) {
  const tz = ctx.settings?.timezone || "UTC";
  return currentCycleKey(localWorkDate(new Date(), tz), ctx.settings?.salaryCycleStartDay ?? 1);
}

/** Frozen figures for a provisional slip, built with the same helper as finalized slips. */
function buildSnapshot(c: Awaited<ReturnType<typeof computeMonth>>, asOf: Date, tz: string): SlipSnapshot {
  return {
    period: { start: dateKey(c.period.start), end: dateKey(c.period.end) },
    salaryDate: dateKey(c.salaryDate),
    disbursementDate: dateKey(c.disbursementDate),
    asOf: dateKey(localWorkDate(asOf, tz)),
    breakdown: breakdownOf(c),
  };
}
