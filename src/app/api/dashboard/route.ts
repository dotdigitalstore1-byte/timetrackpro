import { NextResponse } from "next/server";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  attendance,
  departments,
  employeeDepartments,
  employeeLocations,
  employees,
  geofences,
  leaveRequests,
  managerDepartments,
  salaryRecords,
  users,
} from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { loadAccess, visibleEmployeeIds } from "@/lib/access";
import { holidayKeys, shiftOf, weeklyOffOf } from "@/lib/company";
import {
  addDays,
  currentCycleKey,
  cyclePeriod,
  dateKey,
  effectiveStatus,
  localParts,
  localWorkDate,
  parseHHMM,
  summarizeMonth,
  type DayRecord,
} from "@/lib/payroll";

/**
 * Everything the home screen shows, in one request. Figures are scoped to the viewer:
 * admins see the whole company, managers see their team. Admins and managers are never counted as employees.
 */
export async function GET() {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await loadAccess(ctx);
  if (!access.isAdmin && !access.isManager) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const companyId = ctx.company!.id;
  const settings = ctx.settings!;
  const tz = settings.timezone || "UTC";
  const now = new Date();
  const today = localWorkDate(now, tz);
  const todayKey = dateKey(today);
  const { year, month } = currentCycleKey(today, settings.salaryCycleStartDay);
  const period = cyclePeriod(year, month, settings.salaryCycleStartDay);
  const cycleStart = period.start;
  const cycleEndExclusive = addDays(period.end, 1);

  // ---- who is in scope
  const visible = await visibleEmployeeIds(ctx, access);
  const allEmployees = await db
    .select({
      employee: employees,
      fullName: users.fullName,
      isActive: users.isActive,
    })
    .from(employees)
    .innerJoin(users, eq(employees.userId, users.id))
    .where(and(eq(employees.companyId, companyId), eq(users.role, "employee")));
  const scoped = allEmployees.filter((e) => visible.has(e.employee.id));
  const active = scoped.filter((e) => e.isActive);
  const activeIds = active.map((e) => e.employee.id);
  const scopedIds = scoped.map((e) => e.employee.id);

  const [cycleRows, cycleLeaves, pendingRows, holidays] = await Promise.all([
    scopedIds.length
      ? db
          .select({
            employeeId: attendance.employeeId,
            workDate: attendance.workDate,
            punchInTime: attendance.punchInTime,
            punchOutTime: attendance.punchOutTime,
            status: attendance.status,
          })
          .from(attendance)
          .where(
            and(
              eq(attendance.companyId, companyId),
              inArray(attendance.employeeId, scopedIds),
              gte(attendance.workDate, cycleStart),
              lt(attendance.workDate, cycleEndExclusive)
            )
          )
      : Promise.resolve([]),
    scopedIds.length
      ? db
          .select()
          .from(leaveRequests)
          .where(
            and(
              eq(leaveRequests.companyId, companyId),
              inArray(leaveRequests.employeeId, scopedIds),
              eq(leaveRequests.status, "approved"),
              lt(leaveRequests.startDate, cycleEndExclusive),
              gte(leaveRequests.endDate, cycleStart)
            )
          )
      : Promise.resolve([]),
    scopedIds.length
      ? db
          .select({
            id: leaveRequests.id,
            employeeId: leaveRequests.employeeId,
            leaveType: leaveRequests.leaveType,
            startDate: leaveRequests.startDate,
            endDate: leaveRequests.endDate,
            days: leaveRequests.days,
            reason: leaveRequests.reason,
            currentLevel: leaveRequests.currentLevel,
            createdAt: leaveRequests.createdAt,
          })
          .from(leaveRequests)
          .where(and(eq(leaveRequests.companyId, companyId), inArray(leaveRequests.employeeId, scopedIds), eq(leaveRequests.status, "pending")))
          .orderBy(asc(leaveRequests.createdAt))
      : Promise.resolve([]),
    holidayKeys(companyId, cycleStart, cycleEndExclusive),
  ]);

  const nameById = new Map(scoped.map((e) => [e.employee.id, e.fullName]));
  const weeklyOff = weeklyOffOf(settings);
  const todayRows = cycleRows.filter((r) => dateKey(r.workDate) === todayKey);
  const todayPunched = new Set(todayRows.filter((r) => r.punchInTime).map((r) => r.employeeId));
  const todayLeaveIds = new Set(
    cycleLeaves
      .filter((l) => l.startDate.getTime() <= today.getTime() && l.endDate.getTime() >= today.getTime())
      .map((l) => l.employeeId)
  );
  const isOffDay = weeklyOff.has(today.getUTCDay()) || holidays.has(todayKey);
  const minutesNow = localParts(now, tz).minutes;
  const activeSet = new Set(activeIds);

  const absentToday = isOffDay
    ? 0
    : active.filter(
        (e) =>
          !todayPunched.has(e.employee.id) &&
          !todayLeaveIds.has(e.employee.id) &&
          minutesNow > parseHHMM(shiftOf(settings, e.employee).start) + settings.graceMinutes
      ).length;

  // Cycle-to-date totals use the same rules as payroll.
  const cycleLateCount = cycleRows.filter((r) => activeSet.has(r.employeeId) && r.status === "late").length;
  const cycleHalfDays = cycleRows.filter((r) => activeSet.has(r.employeeId) && effectiveStatus({ status: r.status, hasPunchIn: !!r.punchInTime, hasPunchOut: !!r.punchOutTime }, r.workDate, today) === "half_day").length;
  let cycleAbsentDays = 0;
  let cycleLeaveDays = 0;
  const byEmployee = new Map<string, typeof cycleRows>();
  for (const r of cycleRows) {
    const list = byEmployee.get(r.employeeId) ?? [];
    list.push(r);
    byEmployee.set(r.employeeId, list);
  }
  for (const e of active) {
    const recs = new Map<string, DayRecord>();
    for (const r of byEmployee.get(e.employee.id) ?? []) {
      recs.set(dateKey(r.workDate), { status: r.status, hasPunchIn: !!r.punchInTime, hasPunchOut: !!r.punchOutTime });
    }
    const sum = summarizeMonth({
      year,
      month,
      period,
      weeklyOff,
      holidays,
      records: recs,
      approvedLeaves: cycleLeaves.filter((l) => l.employeeId === e.employee.id).map((l) => ({ start: l.startDate, end: l.endDate })),
      todayLocal: today,
      joinDate: localWorkDate(e.employee.hireDate, tz),
    });
    cycleAbsentDays += sum.absentDays;
    cycleLeaveDays += sum.leaveDays;
  }

  // ---- approvals (scoped, newest first)
  const pendingLeaves = pendingRows.slice(0, 10).map((l) => ({
    id: l.id,
    employeeName: nameById.get(l.employeeId) ?? "",
    leaveType: l.leaveType,
    startDate: l.startDate,
    endDate: l.endDate,
    days: l.days,
    reason: l.reason,
    currentLevel: l.currentLevel,
  }));

  const response: Record<string, unknown> = {
    viewer: { role: ctx.user.role, permissions: access.permissions },
    today: {
      date: todayKey,
      isOffDay,
      totalEmployees: active.length,
      present: active.filter((e) => todayPunched.has(e.employee.id)).length,
      clockedIn: active.filter((e) => todayRows.some((r) => r.employeeId === e.employee.id && r.punchInTime && !r.punchOutTime)).length,
      absent: absentToday,
      onLeave: active.filter((e) => todayLeaveIds.has(e.employee.id)).length,
      late: todayRows.filter((r) => activeSet.has(r.employeeId) && r.status === "late").length,
      halfDay: todayRows.filter((r) => activeSet.has(r.employeeId) && r.status === "half_day").length,
      pendingLeaves: pendingRows.length,
    },
    cycle: {
      label: `${dateKey(period.start)} → ${dateKey(period.end)}`,
      start: dateKey(period.start),
      end: dateKey(period.end),
      lateMarks: cycleLateCount,
      halfDays: cycleHalfDays,
      absentDays: Math.round(cycleAbsentDays * 10) / 10,
      leaveDays: Math.round(cycleLeaveDays * 10) / 10,
    },
    pendingLeaves,
  };

  if (access.isAdmin) {
    // Payroll progress for this cycle: what is saved, and who still needs calculating.
    const payroll = await db
      .select({
        employeeId: salaryRecords.employeeId,
        status: salaryRecords.status,
        netPayable: salaryRecords.netPayable,
        totalDeductions: salaryRecords.totalDeductions,
      })
      .from(salaryRecords)
      .where(and(eq(salaryRecords.companyId, companyId), eq(salaryRecords.month, month), eq(salaryRecords.year, year)));
    const savedFor = new Set(payroll.map((p) => p.employeeId));
    const count1 = (st: string) => payroll.filter((p) => p.status === st).length;
    response.payroll = {
      label: `${dateKey(period.start)} → ${dateKey(period.end)}`,
      activeEmployees: active.length,
      draft: count1("draft"),
      finalized: count1("finalized"),
      paid: count1("paid"),
      notCalculated: active.filter((e) => !savedFor.has(e.employee.id)).length,
      netPayable: payroll.filter((p) => p.status !== "draft").reduce((t, p) => t + Number(p.netPayable), 0).toFixed(2),
      totalDeductions: payroll.filter((p) => p.status !== "draft").reduce((t, p) => t + Number(p.totalDeductions), 0).toFixed(2),
    };

    // Setup gaps that stop the company working correctly.
    const [depts, locs, empDept, empLoc, managers] = await Promise.all([
      db.select({ id: departments.id, isActive: departments.isActive }).from(departments).where(eq(departments.companyId, companyId)),
      db.select({ id: geofences.id, isActive: geofences.isActive }).from(geofences).where(eq(geofences.companyId, companyId)),
      db
        .select({ employeeId: employeeDepartments.employeeId })
        .from(employeeDepartments)
        .innerJoin(employees, eq(employeeDepartments.employeeId, employees.id))
        .where(eq(employees.companyId, companyId)),
      db
        .select({ employeeId: employeeLocations.employeeId })
        .from(employeeLocations)
        .innerJoin(employees, eq(employeeLocations.employeeId, employees.id))
        .where(eq(employees.companyId, companyId)),
      db
        .select({ id: users.id, isActive: users.isActive })
        .from(users)
        .where(and(eq(users.companyId, companyId), eq(users.role, "manager"))),
    ]);
    const hasDept = new Set(empDept.map((r) => r.employeeId));
    const hasLoc = new Set(empLoc.map((r) => r.employeeId));
    const managerDeptRows = managers.length
      ? await db.select({ userId: managerDepartments.userId }).from(managerDepartments).where(inArray(managerDepartments.userId, managers.map((m) => m.id)))
      : [];
    const managersWithoutScope = managers.filter((m) => !managerDeptRows.some((r) => r.userId === m.id)).length;

    response.setup = {
      departments: { total: depts.length, active: depts.filter((d) => d.isActive).length },
      locations: { total: locs.length, active: locs.filter((l) => l.isActive).length },
      managers: { total: managers.length, active: managers.filter((m) => m.isActive).length, withoutDepartment: managersWithoutScope },
      employeesWithoutDepartment: active.filter((e) => !hasDept.has(e.employee.id)).length,
      employeesWithoutLocation: active.filter((e) => !hasLoc.has(e.employee.id)).length,
      rules: {
        graceMinutes: settings.graceMinutes,
        lateThresholdMinutes: settings.lateThresholdMinutes,
        salaryCycleStartDay: settings.salaryCycleStartDay,
        overtimeEnabled: settings.overtimeEnabled,
        lateMarksLimit: settings.lateMarksLimit,
        approvalLevels: settings.approvalLevels,
      },
    };
  }

  if (access.isManager) {
    const [deptRows] = await Promise.all([
      access.departmentIds.length
        ? db.select({ name: departments.name }).from(departments).where(inArray(departments.id, access.departmentIds))
        : Promise.resolve([]),
    ]);
    response.team = {
      size: active.length,
      departments: deptRows.map((d) => d.name),
      locationCount: access.locationIds.length,
    };
  }

  return NextResponse.json(response);
}
