import { NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { attendance, employeeLocations, employees, geofences, users } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { toClientRecord, validPhoto } from "@/lib/attendance-shape";
import { policyFrom } from "@/lib/company";
import { computeStatus, dateKey, localWorkDate } from "@/lib/payroll";
import { haversineMeters } from "@/lib/utils";

function parseMonth(value: string | null, tz: string): { year: number; month: number } {
  if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    const [y, m] = value.split("-").map(Number);
    return { year: y, month: m };
  }
  const t = localWorkDate(new Date(), tz);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1 };
}

export async function GET(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role === "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const tz = ctx.settings?.timezone ?? "UTC";
  const url = new URL(req.url);
  const { year, month } = parseMonth(url.searchParams.get("month"), tz);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1)); // exclusive
  const companyId = ctx.company!.id;
  const today = dateKey(localWorkDate(new Date(), tz));

  let employeeIds: string[];
  if (ctx.user.role === "company_admin") {
    const filterEmp = url.searchParams.get("employeeId");
    if (filterEmp) employeeIds = [filterEmp];
    else {
      const all = await db.select({ id: employees.id }).from(employees).where(eq(employees.companyId, companyId));
      employeeIds = all.map((e) => e.id);
    }
  } else if (ctx.user.role === "manager") {
    const managed = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.companyId, companyId), eq(employees.managerId, ctx.employee!.id)));
    employeeIds = [...new Set([...managed.map((m) => m.id), ctx.employee!.id])];
  } else {
    employeeIds = ctx.employee ? [ctx.employee.id] : [];
  }

  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  if (employeeIds.length === 0) return NextResponse.json({ records: [], today, month: monthKey });

  const rows = await db
    .select()
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

  return NextResponse.json({
    today,
    month: monthKey,
    records: rows.map((r) => ({ ...toClientRecord(r.attendance), employeeName: r.users.fullName })),
  });
}

export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role === "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!ctx.employee || !ctx.settings) return NextResponse.json({ error: "Employee profile not found" }, { status: 400 });

  const companyId = ctx.company!.id;
  const employeeId = ctx.employee.id;
  if (!ctx.employee.isActive) return NextResponse.json({ error: "Your employee profile is inactive." }, { status: 403 });

  let body: { type?: string; photo?: unknown; lat?: unknown; lng?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const type = body.type === "out" ? "out" : "in";
  const lat = Number(body.lat);
  const lng = Number(body.lng);

  if (!validPhoto(body.photo)) return NextResponse.json({ error: "A valid photograph is required for punching." }, { status: 400 });
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "A valid GPS location is required for punching." }, { status: 400 });
  }
  const photo = body.photo;

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

  const now = new Date(); // server timestamp — the client clock is never trusted
  const tz = ctx.settings.timezone || "UTC";
  const workDate = localWorkDate(now, tz);

  const existing = (
    await db
      .select()
      .from(attendance)
      .where(and(eq(attendance.employeeId, employeeId), eq(attendance.workDate, workDate)))
      .limit(1)
  )[0];

  if (type === "in") {
    if (existing?.punchInTime) return NextResponse.json({ error: "You have already punched in today." }, { status: 400 });
    const status = computeStatus(now, policyFrom(ctx.settings));

    const values = {
      punchInTime: now,
      punchInPhoto: photo,
      punchInLat: String(lat),
      punchInLng: String(lng),
      status,
      updatedAt: now,
    };
    if (existing) {
      const [rec] = await db.update(attendance).set(values).where(eq(attendance.id, existing.id)).returning();
      return NextResponse.json({ ok: true, record: toClientRecord(rec), status });
    }
    const inserted = await db
      .insert(attendance)
      .values({ companyId, employeeId, workDate, ...values })
      .onConflictDoNothing({ target: [attendance.employeeId, attendance.workDate] })
      .returning();
    if (!inserted[0]) return NextResponse.json({ error: "You have already punched in today." }, { status: 409 });
    return NextResponse.json({ ok: true, record: toClientRecord(inserted[0]), status });
  }

  // punch out
  if (!existing || !existing.punchInTime) return NextResponse.json({ error: "No punch-in found for today. Punch in first." }, { status: 400 });
  if (existing.punchOutTime) return NextResponse.json({ error: "You have already punched out today." }, { status: 400 });
  if (now.getTime() - existing.punchInTime.getTime() < 60_000) {
    return NextResponse.json({ error: "Please wait a minute after punching in before punching out." }, { status: 400 });
  }

  const [updated] = await db
    .update(attendance)
    .set({ punchOutTime: now, punchOutPhoto: photo, punchOutLat: String(lat), punchOutLng: String(lng), updatedAt: now })
    .where(eq(attendance.id, existing.id))
    .returning();
  return NextResponse.json({ ok: true, record: toClientRecord(updated) });
}
