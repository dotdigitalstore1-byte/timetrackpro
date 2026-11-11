import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, salarySlipRequests, users } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { computeMonth } from "@/lib/salary";
import { breakdownOf } from "@/lib/salary-breakdown";
import { dateKey } from "@/lib/payroll";
import { loadCompanyProfile } from "@/lib/company-profile";
import type { SlipSnapshot } from "@/lib/slip-snapshot";

/**
 * The payslip for an approved request. Employees may read their own slip only while it is within its
 * 90-day access window; admins can always read it. Figures are the frozen, finalized ones.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuth();
  if (!ctx || !ctx.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const companyId = ctx.company.id;
  const isAdmin = ctx.user.role === "company_admin";
  const isOwner = !!ctx.employee && ctx.user.role === "employee";
  if (!isAdmin && !isOwner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [request] = await db
    .select()
    .from(salarySlipRequests)
    .where(and(eq(salarySlipRequests.id, id), eq(salarySlipRequests.companyId, companyId)))
    .limit(1);
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (isOwner && request.employeeId !== ctx.employee!.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (request.status !== "approved") {
    return NextResponse.json({ error: "This salary slip has not been approved." }, { status: 403 });
  }
  const now = new Date();
  if (isOwner && (!request.availableUntil || now >= request.availableUntil)) {
    return NextResponse.json(
      { error: "The 90-day download window for this salary slip has ended. Ask your admin for help if you still need it." },
      { status: 410 }
    );
  }

  const [emp] = await db
    .select({ name: users.fullName, code: employees.employeeCode, designation: employees.designation })
    .from(employees)
    .innerJoin(users, eq(employees.userId, users.id))
    .where(eq(employees.id, request.employeeId))
    .limit(1);

  const company = await loadCompanyProfile(companyId);
  const employee = { name: emp?.name ?? "", code: emp?.code ?? null, designation: emp?.designation ?? null };
  const c = await computeMonth(companyId, request.employeeId, request.year, request.month);

  // Finalized cycle: the final figures, as always.
  if (c.frozen) {
    return NextResponse.json({
      company,
      employee,
      provisional: false,
      period: { start: dateKey(c.period.start), end: dateKey(c.period.end) },
      salaryDate: dateKey(c.salaryDate),
      disbursementDate: dateKey(c.disbursementDate),
      status: c.record?.status ?? "finalized",
      availableUntil: request.availableUntil,
      breakdown: breakdownOf(c),
    });
  }

  // Cycle still running: the figures frozen when the admin approved the request (provisional).
  const snap = request.snapshot as SlipSnapshot | null;
  if (!request.provisional || !snap) {
    return NextResponse.json({ error: "This salary has not been finalized yet." }, { status: 400 });
  }
  return NextResponse.json({
    company,
    employee,
    provisional: true,
    asOf: snap.asOf,
    period: snap.period,
    salaryDate: snap.salaryDate ?? snap.payDate,
    disbursementDate: snap.disbursementDate ?? snap.salaryDate ?? snap.payDate,
    status: "provisional",
    availableUntil: request.availableUntil,
    breakdown: snap.breakdown,
  });
}
