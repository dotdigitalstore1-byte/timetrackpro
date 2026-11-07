import { NextResponse } from "next/server";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, employees, salaryRecords, users } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { can, canSeeEmployee, loadAccess } from "@/lib/access";
import { addDays, currentCycleKey, cyclePeriod, dateKey, localWorkDate, recentCycles } from "@/lib/payroll";
import { computeMonth, finalizeMonth, releaseHold, saveDraft } from "@/lib/salary";

/** The requested cycle ("YYYY-MM", named by the month it ends in), or the cycle that contains today. */
function parseMonth(value: string | null | undefined, tz: string, cycleStartDay: number): { year: number; month: number } {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    const [y, m] = value.split("-").map(Number);
    return { year: y, month: m };
  }
  return currentCycleKey(localWorkDate(new Date(), tz), cycleStartDay);
}

export async function GET(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role === "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const companyId = ctx.company!.id;
  const tz = ctx.settings?.timezone ?? "UTC";
  const cycleStartDay = ctx.settings?.salaryCycleStartDay ?? 1;

  const url = new URL(req.url);
  const { year, month } = parseMonth(url.searchParams.get("month"), tz, cycleStartDay);
  const requested = url.searchParams.get("employeeId");

  // Admins can open any employee. Managers with the view_salary power can open people on their team (read only).
  const access = await loadAccess(ctx);
  let employeeId: string;
  if (requested) {
    const allowed = access.isAdmin || (can(access, "view_salary") && (await canSeeEmployee(ctx, access, requested)));
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    employeeId = requested;
  } else if (ctx.employee) {
    employeeId = ctx.employee.id;
  } else {
    return NextResponse.json({ error: access.isAdmin ? "Select an employee." : "Employee profile not found." }, { status: 400 });
  }

  let c;
  try {
    c = await computeMonth(companyId, employeeId, year, month); // read-only
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not compute salary" }, { status: 404 });
  }

  const history = await db
    .select()
    .from(salaryRecords)
    .where(
      and(
        eq(salaryRecords.companyId, companyId),
        eq(salaryRecords.employeeId, employeeId),
        // employees only see finalized/paid history; admins also see drafts
        ...(ctx.user.role === "company_admin" ? [] : [ne(salaryRecords.status, "draft")])
      )
    )
    .orderBy(desc(salaryRecords.year), desc(salaryRecords.month))
    .limit(24);

  const emp = await db
    .select()
    .from(employees)
    .innerJoin(users, eq(employees.userId, users.id))
    .where(and(eq(employees.companyId, companyId), eq(employees.id, employeeId)))
    .limit(1);

  const r = c.result;
  const s = c.summary;
  return NextResponse.json({
    employee: emp[0]
      ? { id: emp[0].employees.id, fullName: emp[0].users.fullName, designation: emp[0].employees.designation }
      : null,
    month,
    year,
    period: { start: dateKey(c.period.start), end: dateKey(c.period.end) },
    // the last 12 salary cycles, newest first, for the cycle picker
    cycles: recentCycles(localWorkDate(new Date(), tz), cycleStartDay, 12).map((k) => ({
      key: k.key,
      start: dateKey(k.start),
      end: dateKey(k.end),
    })),
    payDate: dateKey(addDays(c.period.end, ctx.settings?.salaryPayDelayDays ?? 0)),
    status: c.record?.status ?? "preview", // preview (not saved) | draft | finalized | paid
    frozen: c.frozen,
    breakdown: {
      basicSalary: c.basicSalary,
      dailyRate: r.dailyRate,
      presentDays: s.presentDays,
      absentDays: s.absentDays,
      lateDays: s.lateDays,
      halfDays: s.halfDays,
      leaveDays: s.leaveDays,
      unapprovedLeaveCount: s.unapprovedOccurrences.length,
      attendanceSalary: r.attendanceSalary,
      // per-late deduction plus the "every N late marks" penalty
      lateDeduction: Math.round((r.lateDeduction + r.lateMarksDeduction) * 100) / 100,
      earlyLeaveDays: s.earlyLeaveDays ?? 0,
      earlyLeaveDeduction: r.earlyLeaveDeduction,
      overtimeMinutes: s.overtimeMinutes ?? 0,
      overtimePay: r.overtimePay,
      weekOffWorkedDays: r.weekOffWorkedDays,
      compOffUsed: r.compOffUsed,
      compOffUnused: r.compOffUnused,
      unpaidLeaveDays: r.unpaidLeaveDays,
      extraPayDays: r.extraPayDays,
      extraPay: r.extraPay,
      additions: c.additions,
      additionsTotal: r.additionsTotal,
      halfDayDeduction: r.halfDayDeduction,
      leaveDeduction: r.leaveDeduction,
      otherDeductions: c.otherDeductions,
      // permanent deductions (holds are NOT included here)
      totalDeductions: r.totalDeductions,
      // temporary, releasable holds are reported separately
      salaryHoldDays: r.holdDays,
      salaryHoldAmount: r.holdAmount,
      netBeforeHold: r.netBeforeHold,
      netPayable: r.netPayable,
    },
    holds: c.holds.map((h) => ({
      id: h.id ?? null,
      days: h.days,
      amount: h.amount,
      reason: "Unapproved leave",
      occurrenceDate: h.occurrenceDate,
      status: h.status,
    })),
    history: history.map((h) => ({
      id: h.id,
      month: h.month,
      year: h.year,
      periodStart: h.periodStart ? dateKey(h.periodStart) : null,
      periodEnd: h.periodEnd ? dateKey(h.periodEnd) : null,
      basicSalary: h.basicSalary,
      attendanceSalary: h.attendanceSalary,
      totalDeductions: h.totalDeductions,
      salaryHoldAmount: h.salaryHoldAmount,
      netPayable: h.netPayable,
      status: h.status,
    })),
  });
}

// Admin payroll actions: calculate | finalize | finalize_all | mark_paid | add_deduction | remove_deduction | release_hold
export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Only company admins can run payroll." }, { status: 403 });
  const companyId = ctx.company!.id;
  const tz = ctx.settings?.timezone ?? "UTC";
  const cycleStartDay = ctx.settings?.salaryCycleStartDay ?? 1;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const action = String(body.action || "");
  const { year, month } = parseMonth(typeof body.month === "string" ? body.month : null, tz, cycleStartDay);
  const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";

  // A cycle can only be finalized after its last day has passed (honours custom salary cycles).
  const monthEnded = () => {
    const today = localWorkDate(new Date(), tz).getTime();
    const endOfCycle = cyclePeriod(year, month, cycleStartDay).end.getTime();
    return today > endOfCycle;
  };

  try {
    if (action === "release_hold") {
      await releaseHold(companyId, String(body.holdId || ""), ctx.user.id);
      return NextResponse.json({ ok: true });
    }

    if (action === "finalize_all") {
      if (!monthEnded()) return NextResponse.json({ error: "This salary cycle has not ended yet." }, { status: 400 });
      const emps = await db
        .select()
        .from(employees)
        .where(and(eq(employees.companyId, companyId), eq(employees.isActive, true)));
      let finalized = 0;
      let skipped = 0;
      for (const e of emps) {
        if (Number(e.basicSalary) <= 0) { skipped++; continue; }
        const c = await computeMonth(companyId, e.id, year, month);
        if (c.frozen) { skipped++; continue; }
        await finalizeMonth(companyId, e.id, year, month, ctx.user.id);
        finalized++;
      }
      return NextResponse.json({ ok: true, finalized, skipped });
    }

    if (!employeeId) return NextResponse.json({ error: "employeeId is required" }, { status: 400 });

    if (action === "calculate") {
      const rec = await saveDraft(companyId, employeeId, year, month);
      return NextResponse.json({ ok: true, status: rec.status });
    }

    if (action === "finalize") {
      if (!monthEnded()) return NextResponse.json({ error: "This salary cycle has not ended yet." }, { status: 400 });
      const rec = await finalizeMonth(companyId, employeeId, year, month, ctx.user.id);
      return NextResponse.json({ ok: true, status: rec.status });
    }

    if (action === "mark_paid") {
      const rows = await db
        .select()
        .from(salaryRecords)
        .where(and(eq(salaryRecords.companyId, companyId), eq(salaryRecords.employeeId, employeeId), eq(salaryRecords.year, year), eq(salaryRecords.month, month)))
        .limit(1);
      if (!rows[0] || rows[0].status !== "finalized") {
        return NextResponse.json({ error: "Only finalized salaries can be marked as paid." }, { status: 400 });
      }
      await db.update(salaryRecords).set({ status: "paid", paidAt: new Date(), updatedAt: new Date() }).where(eq(salaryRecords.id, rows[0].id));
      await db.insert(auditLogs).values({ companyId, actorId: ctx.user.id, action: "salary.paid", entity: "salary", entityId: rows[0].id, details: { employeeId, year, month } });
      return NextResponse.json({ ok: true });
    }

    if (["add_deduction", "remove_deduction", "add_addition", "remove_addition"].includes(action)) {
      const isAddition = action.endsWith("_addition");
      const adding = action.startsWith("add_");
      const draft = await saveDraft(companyId, employeeId, year, month); // throws if frozen
      const list = [...(((isAddition ? draft.additions : draft.otherDeductions) ?? []) as { label: string; amount: number }[])];
      if (adding) {
        const label = String(body.label || "").trim().slice(0, 100);
        const amount = Number(body.amount);
        if (!label || !Number.isFinite(amount) || amount <= 0) {
          return NextResponse.json({ error: "Enter a label and a positive amount." }, { status: 400 });
        }
        list.push({ label, amount: Math.round(amount * 100) / 100 });
      } else {
        const idx = Number(body.index);
        if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) return NextResponse.json({ error: "Entry not found." }, { status: 404 });
        list.splice(idx, 1);
      }
      await db
        .update(salaryRecords)
        .set(isAddition ? { additions: list } : { otherDeductions: list })
        .where(eq(salaryRecords.id, draft.id));
      await saveDraft(companyId, employeeId, year, month); // refresh totals
      await db.insert(auditLogs).values({ companyId, actorId: ctx.user.id, action: `salary.${action}`, entity: "salary", entityId: draft.id, details: { employeeId, year, month, list } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Payroll action failed" }, { status: 400 });
  }
}
