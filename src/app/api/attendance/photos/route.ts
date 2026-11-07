import { NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendance, auditLogs, employeeDepartments, employees, users } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { loadEmployeeOrg } from "@/lib/org";
import { purgeExpiredPhotos } from "@/lib/photos";
import { can, loadAccess, visibleEmployeeIds } from "@/lib/access";
import {
  addDays,
  currentCycleKey,
  cyclePeriod,
  dateKey,
  effectiveStatus,
  localWorkDate,
  PHOTO_RETENTION_DAYS,
} from "@/lib/payroll";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_JSON_ROWS = 3000;
const MAX_XLSX_ROWS = 20000;
const MAX_ROWS_WITH_PHOTOS = 400; // each photo is ~50 KB; larger exports must be split by date or employee

/**
 * Photo audit + bulk export for company admins.
 *  - format=json (default): records for the gallery, photos are loaded from /api/attendance/[id]/photo
 *  - format=xlsx: an Excel file; add photos=1 to embed the punch photos in the sheet
 * Range: from & to (YYYY-MM-DD), or month (YYYY-MM = a salary cycle). Filters: employeeId, departmentId.
 */
export async function GET(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await loadAccess(ctx);
  if (!can(access, "view_photos")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const companyId = ctx.company!.id;
  const tz = ctx.settings?.timezone ?? "UTC";
  const startDay = ctx.settings?.salaryCycleStartDay ?? 1;
  const q = new URL(req.url).searchParams;

  // ---- date range
  let start: Date;
  let endDate: Date; // inclusive
  const from = q.get("from");
  const to = q.get("to");
  const month = q.get("month");
  if (from || to) {
    if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
      return NextResponse.json({ error: "Choose a valid from and to date." }, { status: 400 });
    }
    start = new Date(`${from}T00:00:00Z`);
    endDate = new Date(`${to}T00:00:00Z`);
    if (endDate < start) return NextResponse.json({ error: "The end date is before the start date." }, { status: 400 });
    if ((endDate.getTime() - start.getTime()) / 86400000 > 366) {
      return NextResponse.json({ error: "Choose a range of up to one year at a time." }, { status: 400 });
    }
  } else {
    const cycle =
      month && MONTH_RE.test(month)
        ? (() => {
            const [y, m] = month.split("-").map(Number);
            return { year: y, month: m };
          })()
        : currentCycleKey(localWorkDate(new Date(), tz), startDay);
    const p = cyclePeriod(cycle.year, cycle.month, startDay);
    start = p.start;
    endDate = p.end;
  }
  const endExclusive = addDays(endDate, 1);

  // Retention: clear photos past the 45-day window for this company before anything is served.
  await purgeExpiredPhotos(new Date(), companyId);

  // ---- employee / department filters (always limited to this company's employees)
  const employeeId = q.get("employeeId");
  const departmentId = q.get("departmentId");
  if ((employeeId && !isUuid(employeeId)) || (departmentId && !isUuid(departmentId))) {
    return NextResponse.json({ error: "Invalid filter." }, { status: 400 });
  }
  // Only the people this viewer may see: all employees for an admin, the team for a manager.
  const visible = await visibleEmployeeIds(ctx, access);
  const companyEmployees = await db
    .select({ id: employees.id, name: users.fullName })
    .from(employees)
    .innerJoin(users, eq(employees.userId, users.id))
    .where(eq(employees.companyId, companyId));
  let allowed = new Set(companyEmployees.map((e) => e.id).filter((id) => visible.has(id)));
  if (departmentId) {
    const members = await db
      .select({ employeeId: employeeDepartments.employeeId })
      .from(employeeDepartments)
      .where(eq(employeeDepartments.departmentId, departmentId));
    const memberSet = new Set(members.map((m) => m.employeeId));
    allowed = new Set([...allowed].filter((id) => memberSet.has(id)));
  }
  if (employeeId) allowed = new Set(allowed.has(employeeId) ? [employeeId] : []);
  const ids = [...allowed];
  const nameById = new Map(companyEmployees.map((e) => [e.id, e.name]));

  const format = q.get("format") === "xlsx" ? "xlsx" : "json";
  const withPhotos = format === "xlsx" && q.get("photos") === "1";
  // The gallery (format=json&photos=1) only needs days that have a photo; the data export always includes every day.
  const onlyWithPhotos = format === "json" && q.get("photos") === "1";

  // Metadata only (no image data) so the gallery stays light; photo bytes are loaded just for Excel-with-photos.
  const rows =
    ids.length === 0
      ? []
      : await db
          .select({
            id: attendance.id,
            employeeId: attendance.employeeId,
            workDate: attendance.workDate,
            punchInTime: attendance.punchInTime,
            punchOutTime: attendance.punchOutTime,
            status: attendance.status,
            earlyLeaveMinutes: attendance.earlyLeaveMinutes,
            overtimeMinutes: attendance.overtimeMinutes,
            hasIn: sql<boolean>`(${attendance.punchInPhoto} is not null)`,
            hasOut: sql<boolean>`(${attendance.punchOutPhoto} is not null)`,
          })
          .from(attendance)
          .where(
            and(
              eq(attendance.companyId, companyId),
              inArray(attendance.employeeId, ids),
              gte(attendance.workDate, start),
              lt(attendance.workDate, endExclusive),
              onlyWithPhotos
                ? sql`(${attendance.punchInPhoto} is not null or ${attendance.punchOutPhoto} is not null)`
                : undefined
            )
          )
          .orderBy(desc(attendance.workDate));

  const limit = format === "json" ? MAX_JSON_ROWS : withPhotos ? MAX_ROWS_WITH_PHOTOS : MAX_XLSX_ROWS;
  if (rows.length > limit) {
    return NextResponse.json(
      {
        error: withPhotos
          ? `Photo export is limited to ${MAX_ROWS_WITH_PHOTOS} records at a time. Narrow the date range, department or employee, or export without photos first.`
          : "Too many records. Narrow the date range, department or employee.",
      },
      { status: 400 }
    );
  }

  const todayLocal = localWorkDate(new Date(), tz);
  const orgs = await loadEmployeeOrg([...new Set(rows.map((r) => r.employeeId))]);
  const deptNames = (empId: string) => (orgs.get(empId)?.departments ?? []).map((d) => d.name).join(", ");
  const photoById = new Map<string, { in: string | null; out: string | null }>();
  if (withPhotos && rows.length) {
    const photoRows = await db
      .select({ id: attendance.id, inPhoto: attendance.punchInPhoto, outPhoto: attendance.punchOutPhoto })
      .from(attendance)
      .where(inArray(attendance.id, rows.map((r) => r.id)));
    for (const p of photoRows) photoById.set(p.id, { in: p.inPhoto, out: p.outPhoto });
  }
  const shaped = rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: nameById.get(r.employeeId) ?? "",
    departments: deptNames(r.employeeId),
    workDate: dateKey(r.workDate),
    punchInTime: r.punchInTime,
    punchOutTime: r.punchOutTime,
    status: effectiveStatus({ status: r.status, hasPunchIn: !!r.punchInTime, hasPunchOut: !!r.punchOutTime }, r.workDate, todayLocal),
    autoHalfDay: !!r.punchInTime && !r.punchOutTime && r.workDate.getTime() < todayLocal.getTime(),
    earlyLeaveMinutes: r.earlyLeaveMinutes,
    overtimeMinutes: r.overtimeMinutes,
    hasPunchInPhoto: !!r.hasIn,
    hasPunchOutPhoto: !!r.hasOut,
  }));
  const periodLabel = { start: dateKey(start), end: dateKey(endDate) };

  if (format === "json") {
    return NextResponse.json({
      period: periodLabel,
      retentionDays: PHOTO_RETENTION_DAYS,
      records: shaped,
    });
  }

  // ---- Excel export
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "TimeTrack Pro";
  const ws = wb.addWorksheet("Attendance");
  ws.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Employee", key: "name", width: 24 },
    { header: "Departments", key: "dept", width: 22 },
    { header: "Status", key: "status", width: 12 },
    { header: "Punch in", key: "in", width: 10 },
    { header: "Punch out", key: "out", width: 10 },
    { header: "Early leave (min)", key: "early", width: 12 },
    { header: "Overtime (min)", key: "ot", width: 12 },
    { header: "Punch-in photo", key: "inPhoto", width: 16 },
    { header: "Punch-out photo", key: "outPhoto", width: 16 },
  ];
  ws.getRow(1).font = { bold: true };
  const timeOf = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d) : "");

  const addPhoto = (dataUrl: string | null, col: number, rowNumber: number) => {
    const m = dataUrl?.match(/^data:image\/(jpeg|png);base64,(.+)$/);
    if (!m) return;
    const imageId = wb.addImage({ base64: m[2], extension: m[1] === "png" ? "png" : "jpeg" });
    ws.addImage(imageId, {
      tl: { col: col + 0.05, row: rowNumber - 1 + 0.05 },
      ext: { width: 96, height: 96 },
    });
  };

  for (const r of shaped) {
    const row = ws.addRow({
      date: r.workDate,
      name: r.employeeName,
      dept: r.departments,
      status: r.status.replace("_", " "),
      in: timeOf(r.punchInTime),
      out: timeOf(r.punchOutTime),
      early: r.earlyLeaveMinutes,
      ot: r.overtimeMinutes,
      inPhoto: withPhotos ? "" : r.hasPunchInPhoto ? "Yes" : "",
      outPhoto: withPhotos ? "" : r.hasPunchOutPhoto ? "Yes" : "",
    });
    if (withPhotos) {
      row.height = 74;
      const photos = photoById.get(r.id);
      addPhoto(photos?.in ?? null, 8, row.number);
      addPhoto(photos?.out ?? null, 9, row.number);
    }
  }

  await db.insert(auditLogs).values({
    companyId,
    actorId: ctx.user.id,
    action: "attendance.export",
    entity: "attendance",
    details: {
      from: periodLabel.start,
      to: periodLabel.end,
      employeeId: employeeId ?? null,
      departmentId: departmentId ?? null,
      records: shaped.length,
      photos: withPhotos,
    },
  });

  const buf = await wb.xlsx.writeBuffer();
  const suffix = `${periodLabel.start}_to_${periodLabel.end}`;
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="attendance-${suffix}${withPhotos ? "-photos" : ""}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
