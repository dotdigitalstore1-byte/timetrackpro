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
import { holidayKeys, shiftOf, summaryRulesOf, weeklyOffOf } from "@/lib/company";
import {
  addDays,
  addState,
  currentCycleKey,
  cyclePeriod,
  dateKey,
  emptyCounts,
  liveDayState,
  localWorkDate,
  STATE_ORDER,
  summarizeMonth,
  type DayRecord,
  type LiveState,
  type RangeCounts,
} from "@/lib/payroll";

/**
 * Live dashboard. One request returns everything the home screen shows, scoped to the viewer:
 * admins see the whole company, managers see their team. Admins and managers are never counted as employees.
 *
 *   range=daily   today, live: punched in, late, half day, absent (no punch after the cool-off), on leave
 *   range=7d      the last 7 days, including today
 *   range=30d     the last 30 days, including today
 *   range=cycle   the current salary cycle, counted the same way as payroll
 *
 * Status is computed from the stored punches and the current clock, so an employee who has not punched in
 * shows as absent as soon as their cool-off has passed. The page polls this endpoint to stay live.
 */
type RangeKey = "daily" | "7d" | "30d" | "cycle";
const RANGE_KEYS: RangeKey[] = ["daily", "7d", "30d", "cycle"];
const RANGE_LABEL: Record<RangeKey, string> = {
  daily: "Today (live)",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  cycle: "Salary cycle",
};
const DAY_MS = 86400000;

function daysBetween(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) out.push(new Date(t));
  return out;
}

interface DayRow {
  status: string;
  hasPunchIn: boolean;
  hasPunchOut: boolean;
  punchInTime: Date | null;
  punchOutTime: Date | null;
}

export async function GET(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await loadAccess(ctx);
  if (!access.isAdmin && !access.isManager) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const requested = url.searchParams.get("range") ?? "daily";
  const rangeKey: RangeKey = (RANGE_KEYS as string[]).includes(requested) ? (requested as RangeKey) : "daily";

  const companyId = ctx.company!.id;
  const settings = ctx.settings!;
  const tz = settings.timezone || "UTC";
  const now = new Date();
  const today = localWorkDate(now, tz);
  const todayKey = dateKey(today);
  const { year, month } = currentCycleKey(today, settings.salaryCycleStartDay);
  const period = cyclePeriod(year, month, settings.salaryCycleStartDay);
  const cycleStart = period.start;
  const cycleEnd = period.end; // inclusive

  // The window the chosen range covers (inclusive). The salary cycle is always loaded for the cycle card.
  const windowStart =
    rangeKey === "daily" ? today : rangeKey === "7d" ? addDays(today, -6) : rangeKey === "30d" ? addDays(today, -29) : cycleStart;
  const windowEnd = rangeKey === "cycle" ? cycleEnd : today;
  const queryStart = windowStart.getTime() < cycleStart.getTime() ? windowStart : cycleStart;
  const queryEndInclusive = windowEnd.getTime() > cycleEnd.getTime() ? windowEnd : cycleEnd;
  const queryEndExclusive = addDays(queryEndInclusive, 1);

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
  const scopedIds = scoped.map((e) => e.employee.id);

  const [rangeRows, rangeLeaves, pendingRows, holidays] = await Promise.all([
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
              gte(attendance.workDate, queryStart),
              lt(attendance.workDate, queryEndExclusive)
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
              lt(leaveRequests.startDate, queryEndExclusive),
              gte(leaveRequests.endDate, queryStart)
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
    holidayKeys(companyId, queryStart, queryEndExclusive),
  ]);

  const nameById = new Map(scoped.map((e) => [e.employee.id, e.fullName]));
  const codeById = new Map(scoped.map((e) => [e.employee.id, e.employee.employeeCode]));
  const weeklyOff = weeklyOffOf(settings);
  const isOffDay = (d: Date) => weeklyOff.has(d.getUTCDay()) || holidays.has(dateKey(d));

  // Index the rows and leaves by employee so each employee is classified without rescanning everything.
  const recordsByEmp = new Map<string, Map<string, DayRow>>();
  for (const r of rangeRows) {
    const map = recordsByEmp.get(r.employeeId) ?? new Map<string, DayRow>();
    map.set(dateKey(r.workDate), {
      status: r.status,
      hasPunchIn: !!r.punchInTime,
      hasPunchOut: !!r.punchOutTime,
      punchInTime: r.punchInTime,
      punchOutTime: r.punchOutTime,
    });
    recordsByEmp.set(r.employeeId, map);
  }
  const leavesByEmp = new Map<string, { start: Date; end: Date }[]>();
  for (const l of rangeLeaves) {
    const list = leavesByEmp.get(l.employeeId) ?? [];
    list.push({ start: l.startDate, end: l.endDate });
    leavesByEmp.set(l.employeeId, list);
  }
  const onLeave = (employeeId: string, day: Date) =>
    (leavesByEmp.get(employeeId) ?? []).some((l) => day.getTime() >= l.start.getTime() && day.getTime() <= l.end.getTime());

  const roster: {
    employeeId: string;
    name: string;
    code: string | null;
    state: LiveState;
    punchInTime: Date | null;
    punchOutTime: Date | null;
    clockedIn: boolean;
    shiftStart: string;
    shiftEnd: string;
  }[] = [];
  const rows: (RangeCounts & { employeeId: string; name: string; code: string | null })[] = [];
  const todayCounts = emptyCounts();
  const rangeTotals = emptyCounts();
  let punchedToday = 0;
  let clockedInNow = 0;
  let waitingToday = 0;
  const cycleTotals = { lateMarks: 0, halfDays: 0, absentDays: 0, leaveDays: 0, onTime: 0 };

  for (const e of active) {
    const id = e.employee.id;
    const recs = recordsByEmp.get(id) ?? new Map<string, DayRow>();
    const shift = shiftOf(settings, e.employee);
    const joinDate = localWorkDate(e.employee.hireDate, tz);
    const base = { now, tz, todayLocal: today, shiftStart: shift.start, graceMinutes: settings.graceMinutes, joinDate };

    // ---- today: every range shows it (header stats and the live roster)
    const todayRec = recs.get(todayKey) ?? null;
    const todayState = liveDayState({ ...base, workDate: today, record: todayRec, onLeave: onLeave(id, today), offDay: isOffDay(today) });
    addState(todayCounts, todayState);
    if (todayRec?.punchInTime) punchedToday += 1;
    if (todayRec?.punchInTime && !todayRec.punchOutTime) clockedInNow += 1;
    if (todayState === "waiting") waitingToday += 1;
    if (rangeKey === "daily") {
      roster.push({
        employeeId: id,
        name: e.fullName,
        code: e.employee.employeeCode,
        state: todayState,
        punchInTime: todayRec?.punchInTime ?? null,
        punchOutTime: todayRec?.punchOutTime ?? null,
        clockedIn: !!todayRec?.punchInTime && !todayRec.punchOutTime,
        shiftStart: shift.start,
        shiftEnd: shift.end,
      });
    }

    // ---- the salary cycle, counted exactly as payroll counts it
    const cycleRecords = new Map<string, DayRecord>();
    for (const [k, v] of recs) {
      const t = new Date(`${k}T00:00:00Z`).getTime();
      if (t >= cycleStart.getTime() && t <= cycleEnd.getTime()) cycleRecords.set(k, v);
    }
    const cycleSum = summarizeMonth({
      year,
      month,
      period,
      rules: summaryRulesOf(settings),
      weeklyOff,
      holidays,
      records: cycleRecords,
      approvedLeaves: leavesByEmp.get(id) ?? [],
      todayLocal: today,
      joinDate,
    });
    cycleTotals.lateMarks += cycleSum.lateDays;
    cycleTotals.halfDays += cycleSum.halfDays;
    cycleTotals.absentDays += cycleSum.absentDays;
    cycleTotals.leaveDays += cycleSum.leaveDays;
    cycleTotals.onTime += cycleSum.presentDays - cycleSum.lateDays;

    if (rangeKey === "cycle") {
      rows.push({
        employeeId: id,
        name: e.fullName,
        code: e.employee.employeeCode,
        present: cycleSum.presentDays - cycleSum.lateDays,
        late: cycleSum.lateDays,
        halfDay: cycleSum.halfDays,
        absent: Math.round(cycleSum.absentDays * 10) / 10,
        onLeave: Math.round(cycleSum.leaveDays * 10) / 10,
      });
    } else if (rangeKey === "7d" || rangeKey === "30d") {
      const counts = emptyCounts();
      for (const day of daysBetween(windowStart, windowEnd)) {
        if (isOffDay(day)) continue;
        addState(counts, liveDayState({ ...base, workDate: day, record: recs.get(dateKey(day)) ?? null, onLeave: onLeave(id, day), offDay: false }));
      }
      rangeTotals.present += counts.present;
      rangeTotals.late += counts.late;
      rangeTotals.halfDay += counts.halfDay;
      rangeTotals.absent += counts.absent;
      rangeTotals.onLeave += counts.onLeave;
      rows.push({ employeeId: id, name: e.fullName, code: e.employee.employeeCode, ...counts });
    }
  }

  // Summary for the chosen range.
  const summary: RangeCounts =
    rangeKey === "daily"
      ? { ...todayCounts }
      : rangeKey === "cycle"
        ? {
            present: cycleTotals.onTime,
            late: cycleTotals.lateMarks,
            halfDay: cycleTotals.halfDays,
            absent: Math.round(cycleTotals.absentDays * 10) / 10,
            onLeave: Math.round(cycleTotals.leaveDays * 10) / 10,
          }
        : { ...rangeTotals };

  roster.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name));
  rows.sort((a, b) => b.absent - a.absent || b.late - a.late || a.name.localeCompare(b.name));

  // ---- approvals (scoped, newest first)
  const pendingLeaves = pendingRows.slice(0, 10).map((l) => ({
    id: l.id,
    employeeName: nameById.get(l.employeeId) ?? "",
    employeeCode: codeById.get(l.employeeId) ?? null,
    leaveType: l.leaveType,
    startDate: l.startDate,
    endDate: l.endDate,
    days: l.days,
    reason: l.reason,
    currentLevel: l.currentLevel,
  }));

  const response: Record<string, unknown> = {
    viewer: { role: ctx.user.role, permissions: access.permissions },
    range: {
      key: rangeKey,
      label: RANGE_LABEL[rangeKey],
      start: dateKey(windowStart),
      end: dateKey(windowEnd),
      live: rangeKey === "daily",
    },
    generatedAt: now.toISOString(),
    today: {
      date: todayKey,
      isOffDay: isOffDay(today),
      totalEmployees: active.length,
      // "present" keeps its meaning: punched in today (any status).
      present: punchedToday,
      clockedIn: clockedInNow,
      absent: todayCounts.absent,
      onLeave: todayCounts.onLeave,
      late: todayCounts.late,
      halfDay: todayCounts.halfDay,
      waiting: waitingToday,
      pendingLeaves: pendingRows.length,
    },
    summary: { ...summary, totalEmployees: active.length },
    roster,
    rows,
    cycle: {
      label: `${dateKey(period.start)} → ${dateKey(period.end)}`,
      start: dateKey(period.start),
      end: dateKey(period.end),
      lateMarks: cycleTotals.lateMarks,
      halfDays: cycleTotals.halfDays,
      absentDays: Math.round(cycleTotals.absentDays * 10) / 10,
      leaveDays: Math.round(cycleTotals.leaveDays * 10) / 10,
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
        absentAfterPercent: settings.absentAfterPercentEnabled ? settings.absentAfterPercent : null,
      },
    };
  }

  if (access.isManager) {
    const deptRows = access.departmentIds.length
      ? await db.select({ name: departments.name }).from(departments).where(inArray(departments.id, access.departmentIds))
      : [];
    response.team = {
      size: active.length,
      departments: deptRows.map((d) => d.name),
      locationCount: access.locationIds.length,
    };
  }

  return NextResponse.json(response);
}
