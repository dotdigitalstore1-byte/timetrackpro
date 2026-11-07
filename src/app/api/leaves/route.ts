import { NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, lt, lte } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, employees, leaveRequests, users } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { loadAccess, visibleEmployeeIds } from "@/lib/access";
import { holidayKeys, weeklyOffOf } from "@/lib/company";
import { countWorkdaysBetween, leaveCredits, localWorkDate, type LeaveAccrualMode } from "@/lib/payroll";

const LEAVE_TYPES = ["casual", "medical"] as const;

const MAX_RANGE_DAYS = 60;

export async function GET() {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role === "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const companyId = ctx.company!.id;
  const tz = ctx.settings?.timezone ?? "UTC";

  // Admin: every employee. Manager: their team. Employee: themselves.
  const access = await loadAccess(ctx);
  const employeeIds = [...(await visibleEmployeeIds(ctx, access))];

  // Leave balance for the signed-in employee. Leave accrues one day per month from the joining month:
  //  - carry: the whole accrued balance (this calendar year) can be used
  //  - lapse: only this month's leave can be used; unused leave lapses at month end
  const todayLocal = localWorkDate(new Date(), tz);
  const year = todayLocal.getUTCFullYear();
  const month = todayLocal.getUTCMonth();
  let balance = null as null | {
    year: number; quota: number; used: number; pending: number; remaining: number;
    mode: LeaveAccrualMode; accrued: number; thisMonth: number;
  };
  if (ctx.employee) {
    const mode: LeaveAccrualMode = ctx.settings?.leaveAccrualMode === "lapse" ? "lapse" : "carry";
    const mine = await db
      .select()
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.employeeId, ctx.employee.id),
          gte(leaveRequests.startDate, new Date(Date.UTC(year, 0, 1))),
          lt(leaveRequests.startDate, new Date(Date.UTC(year + 1, 0, 1)))
        )
      );
    const credits = leaveCredits({
      joinDate: ctx.employee.hireDate ? localWorkDate(ctx.employee.hireDate, tz) : null,
      today: todayLocal,
      annualCap: ctx.settings?.annualLeaveDays ?? 0,
    });
    const inScope = (startDate: Date) =>
      mode === "carry" || (startDate.getUTCFullYear() === year && startDate.getUTCMonth() === month);
    const sum = (st: string) =>
      mine.filter((l) => l.status === st && inScope(l.startDate)).reduce((t, l) => t + Number(l.days), 0);
    const quota = mode === "lapse" ? credits.thisMonth : credits.accrued;
    const used = sum("approved");
    const pending = sum("pending");
    balance = {
      year, quota, used, pending, remaining: Math.max(0, quota - used - pending),
      mode, accrued: credits.accrued, thisMonth: credits.thisMonth,
    };
  }

  if (employeeIds.length === 0) return NextResponse.json({ leaves: [], balance });

  const rows = await db
    .select()
    .from(leaveRequests)
    .innerJoin(employees, eq(leaveRequests.employeeId, employees.id))
    .innerJoin(users, eq(employees.userId, users.id))
    .where(and(eq(leaveRequests.companyId, companyId), inArray(leaveRequests.employeeId, employeeIds)))
    .orderBy(desc(leaveRequests.createdAt));

  return NextResponse.json({
    balance,
    leaves: rows.map((r) => ({
      id: r.leave_requests.id,
      employeeId: r.leave_requests.employeeId,
      employeeName: r.users.fullName,
      leaveType: r.leave_requests.leaveType,
      startDate: r.leave_requests.startDate,
      endDate: r.leave_requests.endDate,
      days: r.leave_requests.days,
      reason: r.leave_requests.reason,
      status: r.leave_requests.status,
      level1Status: r.leave_requests.level1Status,
      level2Status: r.leave_requests.level2Status,
      currentLevel: r.leave_requests.currentLevel,
      rejectionReason: r.leave_requests.rejectionReason,
      createdAt: r.leave_requests.createdAt,
    })),
  });
}

export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ctx.employee || !ctx.settings || ctx.user.role === "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const companyId = ctx.company!.id;
  const tz = ctx.settings.timezone;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const sd = String(body.startDate || "");
  const ed = String(body.endDate || "");
  if (!dateRe.test(sd) || !dateRe.test(ed)) return NextResponse.json({ error: "Please provide a valid date range." }, { status: 400 });
  const startDate = new Date(`${sd}T00:00:00Z`);
  const endDate = new Date(`${ed}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
    return NextResponse.json({ error: "Please provide a valid date range." }, { status: 400 });
  }
  const requestedType = body.leaveType === undefined ? "casual" : String(body.leaveType);
  if (!(LEAVE_TYPES as readonly string[]).includes(requestedType)) {
    return NextResponse.json({ error: "Choose Casual or Medical leave." }, { status: 400 });
  }
  const leaveType = requestedType;
  const reason = String(body.reason || "").trim().slice(0, 1000);
  if (!reason) return NextResponse.json({ error: "Please provide a reason for the leave." }, { status: 400 });

  // Leave must be requested in advance
  const today = localWorkDate(new Date(), tz);
  if (startDate.getTime() <= today.getTime()) {
    return NextResponse.json({ error: "Leave must be requested in advance — choose a start date after today." }, { status: 400 });
  }
  if ((endDate.getTime() - startDate.getTime()) / 86400000 > MAX_RANGE_DAYS) {
    return NextResponse.json({ error: `A single request can cover at most ${MAX_RANGE_DAYS} days.` }, { status: 400 });
  }

  const holidays = await holidayKeys(companyId, startDate, new Date(endDate.getTime() + 86400000));
  const days = countWorkdaysBetween(startDate, endDate, weeklyOffOf(ctx.settings), holidays);
  if (days <= 0) return NextResponse.json({ error: "The selected dates are all weekly offs or holidays — no leave is needed." }, { status: 400 });

  // No overlap with the employee's own pending/approved requests
  const overlap = await db
    .select({ id: leaveRequests.id })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.employeeId, ctx.employee.id),
        inArray(leaveRequests.status, ["pending", "approved"]),
        lte(leaveRequests.startDate, endDate),
        gte(leaveRequests.endDate, startDate)
      )
    )
    .limit(1);
  if (overlap.length) return NextResponse.json({ error: "You already have a leave request covering some of these dates." }, { status: 409 });

  const [rec] = await db
    .insert(leaveRequests)
    .values({ companyId, employeeId: ctx.employee.id, leaveType, startDate, endDate, days: String(days), reason, currentLevel: 1 })
    .returning();

  await db.insert(auditLogs).values({ companyId, actorId: ctx.user.id, action: "leave.request", entity: "leave", entityId: rec.id, details: { startDate: sd, endDate: ed, days, leaveType } });
  return NextResponse.json({ ok: true, id: rec.id, days });
}
