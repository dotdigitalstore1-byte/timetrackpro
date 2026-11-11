import { NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendance, auditLogs, employeeLocations, employees, geofences, leaveRequests, users } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { toClientRecord, toListRecord, validPhoto } from "@/lib/attendance-shape";
import { calendarDays } from "@/lib/attendance-days";
import { cycleCounts, EMPTY_CYCLE_COUNTS, sumCycleCounts, type CycleCounts } from "@/lib/attendance-stats";
import { loadAccess, visibleEmployeeIds } from "@/lib/access";
import { holidayKeys, policyFor, shiftOf, summaryRulesOf, weeklyOffOf } from "@/lib/company";
import type { AttendanceRecord } from "@/db/schema";
import {
  addDays,
  computeStatus,
  currentCycleKey,
  cyclePeriod,
  dateKey,
  type DayRecord,
  earlyLeaveMinutesOf,
  effectiveStatus,
  localParts,
  localWorkDate,
  overtimeMinutesOf,
  summarizeMonth,
} from "@/lib/payroll";
import { haversineMeters } from "@/lib/utils";
import { verifyChallenge } from "@/lib/capture-token";

/** Largest accepted photo (characters of the data URL). ~190 KB; the client sends ~40-70 KB. */
const MAX_PHOTO_CHARS = 250_000;
/** GPS fixes less accurate than this are rejected (metres). */
const MAX_ACCURACY_METERS = 150;
/** A punch-out this far from the punch-in, this fast, is not physically possible (km/h). */
const MAX_TRAVEL_KMH = 150;
/** A GPS reading older than this (ms, as measured on the device) is stale and is refused. */
const MAX_FIX_AGE_MS = 90_000;
/** Punch photos are always JPEG: the in-app camera produces JPEG, so a PNG/WebP upload is not from the camera. */
const PUNCH_PHOTO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

/** The salary cycle named by `value` (YYYY-MM), or the cycle that contains today when none is given. */
function parseMonth(value: string | null, tz: string, startDay: number): { year: number; month: number } {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    const [y, m] = value.split("-").map(Number);
    return { year: y, month: m };
  }
  return currentCycleKey(localWorkDate(new Date(), tz), startDay);
}

export async function GET(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role === "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const settings = ctx.settings;
  if (!settings) return NextResponse.json({ error: "Company settings not configured" }, { status: 400 });

  const tz = settings.timezone ?? "UTC";
  const url = new URL(req.url);
  // The month parameter names a SALARY CYCLE (e.g. "2026-11" with a 26th start = 26 Oct → 25 Nov).
  const startDay = settings.salaryCycleStartDay ?? 1;
  const { year, month } = parseMonth(url.searchParams.get("month"), tz, startDay);
  const period = cyclePeriod(year, month, startDay);
  const start = period.start;
  const end = addDays(period.end, 1); // exclusive
  const companyId = ctx.company!.id;
  const todayLocal = localWorkDate(new Date(), tz);
  const today = dateKey(todayLocal);

  // Who the viewer may see: admin = all employees, manager = their team, employee = themselves.
  const access = await loadAccess(ctx);
  const visible = await visibleEmployeeIds(ctx, access);
  const filterEmp = url.searchParams.get("employeeId");
  const employeeIds = [...visible].filter((id) => !filterEmp || id === filterEmp);

  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const periodInfo = { start: dateKey(start), end: dateKey(period.end) };
  if (employeeIds.length === 0) {
    return NextResponse.json({ records: [], days: null, summary: EMPTY_CYCLE_COUNTS, today, month: monthKey, period: periodInfo });
  }

  // Select the photo FLAGS, never the photo data: a month of photos would otherwise be sent on every list load.
  const rows = await db
    .select({
      id: attendance.id,
      employeeId: attendance.employeeId,
      workDate: attendance.workDate,
      punchInTime: attendance.punchInTime,
      punchOutTime: attendance.punchOutTime,
      status: attendance.status,
      isManual: attendance.isManual,
      note: attendance.note,
      earlyLeaveMinutes: attendance.earlyLeaveMinutes,
      overtimeMinutes: attendance.overtimeMinutes,
      hasPunchInPhoto: sql<boolean>`(${attendance.punchInPhoto} is not null)`,
      hasPunchOutPhoto: sql<boolean>`(${attendance.punchOutPhoto} is not null)`,
      employeeName: users.fullName,
      employeeCode: employees.employeeCode,
    })
    .from(attendance)
    .innerJoin(employees, eq(attendance.employeeId, employees.id))
    .innerJoin(users, eq(employees.userId, users.id))
    .where(
      and(
        eq(attendance.companyId, companyId),
        inArray(attendance.employeeId, employeeIds),
        gte(attendance.workDate, start),
        lt(attendance.workDate, end)
      )
    )
    .orderBy(desc(attendance.workDate));

  // Everything payroll needs to count the cycle the same way: approved leave, company holidays, join dates, rules.
  const [leaveRows, staffRows, holidays] = await Promise.all([
    db
      .select({ employeeId: leaveRequests.employeeId, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.companyId, companyId),
          inArray(leaveRequests.employeeId, employeeIds),
          eq(leaveRequests.status, "approved"),
          lt(leaveRequests.startDate, end),
          gte(leaveRequests.endDate, start)
        )
      ),
    db
      .select({ id: employees.id, hireDate: employees.hireDate, employeeName: users.fullName, employeeCode: employees.employeeCode })
      .from(employees)
      .innerJoin(users, eq(employees.userId, users.id))
      .where(inArray(employees.id, employeeIds)),
    holidayKeys(companyId, start, end),
  ]);
  const staffById = new Map(staffRows.map((s) => [s.id, s]));
  const leavesByEmp = new Map<string, { start: Date; end: Date }[]>();
  for (const l of leaveRows) {
    const list = leavesByEmp.get(l.employeeId) ?? [];
    list.push({ start: l.startDate, end: l.endDate });
    leavesByEmp.set(l.employeeId, list);
  }
  const weeklyOff = weeklyOffOf(settings);
  const rules = summaryRulesOf(settings);

  // ---- counts: payroll's own summary, one employee at a time (the same function the salary page uses)
  const rowsByEmp = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = rowsByEmp.get(r.employeeId) ?? [];
    list.push(r);
    rowsByEmp.set(r.employeeId, list);
  }
  const totals: CycleCounts[] = [];
  for (const empId of employeeIds) {
    const records = new Map<string, DayRecord>();
    for (const r of rowsByEmp.get(empId) ?? []) {
      records.set(dateKey(r.workDate), {
        status: r.status, // raw status: summarizeMonth applies the mandatory punch-out rule itself
        hasPunchIn: !!r.punchInTime,
        hasPunchOut: !!r.punchOutTime,
        earlyLeaveMinutes: r.earlyLeaveMinutes,
        overtimeMinutes: r.overtimeMinutes,
        punchInMinutes: r.punchInTime ? localParts(r.punchInTime, tz).minutes : null,
        punchOutMinutes: r.punchOutTime ? localParts(r.punchOutTime, tz).minutes : null,
      });
    }
    const hire = staffById.get(empId)?.hireDate;
    const sum = summarizeMonth({
      year,
      month,
      period,
      rules,
      weeklyOff,
      holidays,
      records,
      approvedLeaves: leavesByEmp.get(empId) ?? [],
      todayLocal,
      joinDate: hire ? localWorkDate(hire, tz) : null,
    });
    totals.push(cycleCounts(sum));
  }
  const summary = sumCycleCounts(totals);

  // ---- rows as the list shows them (effective status: a missing punch-out shows as a half day once the day ended)
  const listRows = rows.map((r) => {
    const rec = toListRecord(r);
    const shown = effectiveStatus(
      { status: rec.status, hasPunchIn: !!rec.punchInTime, hasPunchOut: rec.hasPunchOut },
      r.workDate,
      todayLocal
    );
    return { ...rec, status: shown, autoHalfDay: shown === "half_day" && rec.status !== "half_day", employeeName: r.employeeName, employeeCode: r.employeeCode };
  });

  // ---- one employee in view: every calendar date of the cycle, with no gaps (Sunday, Leave, Absent, ...)
  const single = employeeIds.length === 1 ? employeeIds[0] : null;
  const staff = single ? staffById.get(single) : undefined;
  const recordByDate = new Map(listRows.map((r) => [dateKey(r.workDate), r]));
  const days = single
    ? calendarDays({
        period,
        todayLocal,
        weeklyOff,
        holidays,
        recordDates: new Set(recordByDate.keys()),
        approvedLeaves: leavesByEmp.get(single) ?? [],
        joinDate: staff ? localWorkDate(staff.hireDate, tz) : null,
      }).map((d) => ({
        ...d,
        record: recordByDate.get(d.date) ?? null,
        employeeName: staff?.employeeName ?? "",
        employeeCode: staff?.employeeCode ?? null,
      }))
    : null;

  return NextResponse.json({
    today,
    month: monthKey,
    period: periodInfo,
    summary, // the tile counts for the Home page and the Attendance page
    days, // one entry per calendar date (single employee), otherwise null
    records: listRows,
  });
}

export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role === "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (ctx.user.role !== "employee") {
    return NextResponse.json({ error: "Only employees punch attendance. Admins and managers supervise from the dashboard." }, { status: 403 });
  }
  if (!ctx.employee || !ctx.settings) return NextResponse.json({ error: "Employee profile not found" }, { status: 400 });

  const companyId = ctx.company!.id;
  const employeeId = ctx.employee.id;
  if (!ctx.employee.isActive) return NextResponse.json({ error: "Your employee profile is inactive." }, { status: 403 });

  let body: {
    type?: string;
    photo?: unknown;
    lat?: unknown;
    lng?: unknown;
    accuracy?: unknown;
    fixAgeMs?: unknown;
    mockLocation?: unknown;
    challenge?: { ts?: unknown; sig?: unknown };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const type = body.type === "out" ? "out" : "in";
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const now = new Date(); // server timestamp: the client clock is never trusted

  // ---- Anti-spoofing gates (no database work needed for these)
  // A fake-GPS app reports mock locations. The native shell sets mockLocation when the OS says so (see README).
  if (body.mockLocation === true) {
    await logSecurityEvent(companyId, employeeId, ctx.user.id, "punch.blocked", { type, reason: "mock_location" });
    return NextResponse.json(
      { error: "Fake GPS / mock location was detected. Turn off mock-location apps and punch again from your work location." },
      { status: 403 }
    );
  }
  // The punch must come from the authenticated session, made just now (blocks replayed or stored requests).
  if (!verifyChallenge(ctx.sessionToken, body.challenge?.ts, body.challenge?.sig)) {
    return NextResponse.json({ error: "Your punch session expired. Take the photo again." }, { status: 400 });
  }
  if (typeof body.photo === "string" && body.photo.length > MAX_PHOTO_CHARS) {
    return NextResponse.json({ error: "The photo is too large. Retake it with the camera." }, { status: 413 });
  }
  if (!validPhoto(body.photo) || !PUNCH_PHOTO_RE.test(body.photo)) {
    return NextResponse.json({ error: "A live camera photo is required for punching. Gallery photos are not accepted." }, { status: 400 });
  }
  const photo: string = body.photo;

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "A valid GPS location is required for punching." }, { status: 400 });
  }
  const fixAge = Number(body.fixAgeMs);
  if (Number.isFinite(fixAge) && fixAge > MAX_FIX_AGE_MS) {
    return NextResponse.json({ error: "Your GPS reading is out of date. Wait a moment and try again." }, { status: 400 });
  }
  const accuracy = Number(body.accuracy);
  if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_METERS) {
    return NextResponse.json(
      { error: `GPS signal is too weak (about ${Math.round(accuracy)} m). Move to an open area and try again.` },
      { status: 400 }
    );
  }
  // Real receivers never report a 0 m or sub-metre accuracy; mock apps often do. Recorded, not blocked.
  const flags: string[] = [];
  if (Number.isFinite(accuracy) && accuracy < 1) flags.push("implausible_accuracy");

  // Location verification (server-side). Employees punch within the work locations assigned to them;
  // an employee with no assignment may punch at any active company location (legacy behaviour).
  const [allFences, assigned] = await Promise.all([
    db.select().from(geofences).where(eq(geofences.companyId, companyId)),
    db.select({ locationId: employeeLocations.locationId }).from(employeeLocations).where(eq(employeeLocations.employeeId, employeeId)),
  ]);
  const activeFences = allFences.filter((f) => f.isActive);
  if (activeFences.length === 0) {
    return NextResponse.json({ error: "No work location has been configured. Ask your admin to add one under Locations." }, { status: 400 });
  }
  const assignedIds = new Set(assigned.map((a) => a.locationId));
  const allowed = assignedIds.size ? activeFences.filter((f) => assignedIds.has(f.id)) : activeFences;
  if (allowed.length === 0) {
    return NextResponse.json({ error: "Your assigned work location is inactive. Ask your admin to update your locations." }, { status: 400 });
  }
  const within = allowed.some((f) => haversineMeters(lat, lng, Number(f.latitude), Number(f.longitude)) <= f.radiusMeters);
  if (!within) {
    const names = allowed.map((f) => f.name).join(", ");
    return NextResponse.json(
      { error: `You are outside your work location (${names}). Move closer and try again.` },
      { status: 400 }
    );
  }

  const tz = ctx.settings.timezone || "UTC";
  const workDate = localWorkDate(now, tz);

  const existing = (
    await db
      .select()
      .from(attendance)
      .where(and(eq(attendance.employeeId, employeeId), eq(attendance.workDate, workDate)))
      .limit(1)
  )[0];

  // Retries are safe: if this punch was already recorded (for example the first request timed out after the
  // server saved it), the employee gets a success with the saved record instead of an error.
  const duplicate = (record: AttendanceRecord, status: string) =>
    NextResponse.json({ ok: true, duplicate: true, record: toClientRecord(record), status });

  if (type === "in") {
    if (existing?.punchInTime) return duplicate(existing, existing.status);
    const status = computeStatus(now, policyFor(ctx.settings, ctx.employee));
    const values = {
      punchInTime: now,
      punchInPhoto: photo,
      punchInLat: String(lat),
      punchInLng: String(lng),
      status,
      updatedAt: now,
    };

    if (existing) {
      // Conditional write: only succeeds if nobody else punched in between the read and the write.
      const [rec] = await db
        .update(attendance)
        .set(values)
        .where(and(eq(attendance.id, existing.id), isNull(attendance.punchInTime)))
        .returning();
      if (!rec) return duplicate(existing, existing.status);
      await recordFlags(companyId, employeeId, ctx.user.id, type, flags, accuracy);
      return NextResponse.json({ ok: true, record: toClientRecord(rec), status });
    }

    const inserted = await db
      .insert(attendance)
      .values({ companyId, employeeId, workDate, ...values })
      .onConflictDoNothing({ target: [attendance.employeeId, attendance.workDate] })
      .returning();
    if (!inserted[0]) {
      const current = (
        await db.select().from(attendance).where(and(eq(attendance.employeeId, employeeId), eq(attendance.workDate, workDate))).limit(1)
      )[0];
      if (current) return duplicate(current, current.status);
      return NextResponse.json({ error: "Could not record the punch. Please try again." }, { status: 409 });
    }
    await recordFlags(companyId, employeeId, ctx.user.id, type, flags, accuracy);
    return NextResponse.json({ ok: true, record: toClientRecord(inserted[0]), status });
  }

  // punch out
  if (!existing || !existing.punchInTime) return NextResponse.json({ error: "No punch-in found for today. Punch in first." }, { status: 400 });
  if (existing.punchOutTime) return duplicate(existing, existing.status);
  if (now.getTime() - existing.punchInTime.getTime() < 60_000) {
    return NextResponse.json({ error: "Please wait a minute after punching in before punching out." }, { status: 400 });
  }

  // Location-jump check: the punch-out must be reachable from the punch-in in the time that has passed.
  if (existing.punchInLat && existing.punchInLng) {
    const meters = haversineMeters(lat, lng, Number(existing.punchInLat), Number(existing.punchInLng));
    const hours = Math.max((now.getTime() - existing.punchInTime.getTime()) / 3_600_000, 1 / 60);
    if (meters > 500 && meters / 1000 / hours > MAX_TRAVEL_KMH) {
      await logSecurityEvent(companyId, employeeId, ctx.user.id, "punch.blocked", { type, reason: "location_jump", meters: Math.round(meters) });
      return NextResponse.json(
        { error: "Your location changed too quickly since punch-in. Punch out from the work location." },
        { status: 400 }
      );
    }
  }

  // Early leave / overtime are measured against THIS employee's shift end and stored with the punch.
  const shift = shiftOf(ctx.settings, ctx.employee);
  const [updated] = await db
    .update(attendance)
    .set({
      punchOutTime: now,
      punchOutPhoto: photo,
      punchOutLat: String(lat),
      punchOutLng: String(lng),
      earlyLeaveMinutes: earlyLeaveMinutesOf(now, existing.workDate, shift.end, tz),
      overtimeMinutes: overtimeMinutesOf(now, existing.workDate, shift.end, tz),
      updatedAt: now,
    })
    .where(and(eq(attendance.id, existing.id), isNull(attendance.punchOutTime)))
    .returning();
  if (!updated) return duplicate(existing, existing.status);
  await recordFlags(companyId, employeeId, ctx.user.id, type, flags, accuracy);
  return NextResponse.json({ ok: true, record: toClientRecord(updated) });
}

/** Records a blocked punch in the audit trail so admins can see attempted spoofing. */
async function logSecurityEvent(companyId: string, employeeId: string, actorId: string, action: string, details: Record<string, unknown>) {
  await db.insert(auditLogs).values({ companyId, actorId, action, entity: "attendance", entityId: null, details: { employeeId, ...details } });
}

/** Punches that were accepted but look unusual are logged for review. */
async function recordFlags(companyId: string, employeeId: string, actorId: string, type: string, flags: string[], accuracy: number) {
  if (flags.length === 0) return;
  await logSecurityEvent(companyId, employeeId, actorId, "punch.flagged", { type, flags, accuracy });
}
