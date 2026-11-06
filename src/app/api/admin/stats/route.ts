import { NextResponse } from "next/server";
import { and, count, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { attendance, employees, leaveRequests, salaryRecords } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { holidayKeys, shiftOf, weeklyOffOf } from "@/lib/company";
import { addDays, currentCycleKey, cyclePeriod, dateKey, localParts, localWorkDate, parseHHMM, summarizeMonth, type DayRecord } from "@/lib/payroll";

export async function GET() {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin" && ctx.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const settings = ctx.settings!;
  const companyId = ctx.company!.id;
  const tz = settings.timezone || "UTC";

  const now = new Date();
  const today = localWorkDate(now, tz);
  // "This month" means the current salary cycle (the calendar month unless the company uses a custom cycle).
  const { year, month } = currentCycleKey(today, settings.salaryCycleStartDay);
  const period = cyclePeriod(year, month, settings.salaryCycleStartDay);
  const monthStart = period.start;
  const monthEnd = addDays(period.end, 1); // exclusive

  let emps = await db.select().from(employees).where(and(eq(employees.companyId, companyId), eq(employees.isActive, true)));
  // Managers only see their own team (plus themselves)
  if (ctx.user.role === "manager") {
    emps = emps.filter((e) => e.managerId === ctx.employee?.id || e.id === ctx.employee?.id);
  }
  const ids = emps.map((e) => e.id);
  if (ids.length === 0) {
    return NextResponse.json({
      today: { date: dateKey(today), totalEmployees: 0, present: 0, absent: 0, onLeave: 0, late: 0, halfDay: 0, pendingLeaves: 0, isOffDay: false },
      month: { late: 0, halfDay: 0, absent: 0, totalPayroll: "0.00", totalDeductions: "0.00", salaryProcessed: 0 },
    });
  }

  const [monthAttendance, monthLeaves, holidays] = await Promise.all([
    db.select().from(attendance).where(and(eq(attendance.companyId, companyId), inArray(attendance.employeeId, ids), gte(attendance.workDate, monthStart), lt(attendance.workDate, monthEnd))),
    db
      .select()
      .from(leaveRequests)
      .where(and(eq(leaveRequests.companyId, companyId), inArray(leaveRequests.employeeId, ids), eq(leaveRequests.status, "approved"), lt(leaveRequests.startDate, monthEnd), gte(leaveRequests.endDate, monthStart))),
    holidayKeys(companyId, monthStart, monthEnd),
  ]);

  const weeklyOff = weeklyOffOf(settings);
  const todayKey = dateKey(today);
  const isOffDay = weeklyOff.has(today.getUTCDay()) || holidays.has(todayKey);

  const todayRows = monthAttendance.filter((a) => dateKey(a.workDate) === todayKey);
  const presentIds = new Set(todayRows.filter((a) => a.punchInTime).map((a) => a.employeeId));
  const onLeaveIds = new Set(
    monthLeaves.filter((l) => l.startDate.getTime() <= today.getTime() && l.endDate.getTime() >= today.getTime()).map((l) => l.employeeId)
  );

  // "Absent" only means something on a working day once THAT employee's shift start + cool-off has passed.
  const minutesNow = localParts(now, tz).minutes;
  const absentToday = isOffDay
    ? 0
    : emps.filter(
        (e) =>
          !presentIds.has(e.id) &&
          !onLeaveIds.has(e.id) &&
          minutesNow > parseHHMM(shiftOf(settings, e).start) + settings.graceMinutes
      ).length;

  // Month-to-date absences use the same rule as payroll (workdays without punch or approved leave)
  let monthAbsent = 0;
  for (const e of emps) {
    const recs = new Map<string, DayRecord>();
    for (const a of monthAttendance) if (a.employeeId === e.id) recs.set(dateKey(a.workDate), { status: a.status, hasPunchIn: !!a.punchInTime });
    const sum = summarizeMonth({
      year,
      month,
      period,
      weeklyOff,
      holidays,
      records: recs,
      approvedLeaves: monthLeaves.filter((l) => l.employeeId === e.id).map((l) => ({ start: l.startDate, end: l.endDate })),
      todayLocal: today,
      joinDate: localWorkDate(e.hireDate, tz),
    });
    monthAbsent += sum.absentDays;
  }

  const pending = await db
    .select({ count: count() })
    .from(leaveRequests)
    .where(and(eq(leaveRequests.companyId, companyId), inArray(leaveRequests.employeeId, ids), eq(leaveRequests.status, "pending")));

  const payroll = await db
    .select()
    .from(salaryRecords)
    .where(and(eq(salaryRecords.companyId, companyId), eq(salaryRecords.month, month), eq(salaryRecords.year, year)));
  const payrollScoped = ctx.user.role === "company_admin" ? payroll : [];

  return NextResponse.json({
    today: {
      date: todayKey,
      totalEmployees: ids.length,
      present: presentIds.size,
      absent: absentToday,
      onLeave: onLeaveIds.size,
      late: todayRows.filter((a) => a.status === "late").length,
      halfDay: todayRows.filter((a) => a.status === "half_day").length,
      pendingLeaves: pending[0]?.count ?? 0,
      isOffDay,
    },
    month: {
      late: monthAttendance.filter((a) => a.status === "late").length,
      halfDay: monthAttendance.filter((a) => a.status === "half_day").length,
      absent: monthAbsent,
      totalPayroll: payrollScoped.reduce((t, r) => t + Number(r.netPayable), 0).toFixed(2),
      totalDeductions: payrollScoped.reduce((t, r) => t + Number(r.totalDeductions), 0).toFixed(2),
      salaryProcessed: payrollScoped.length,
    },
  });
}
