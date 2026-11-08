import { NextResponse } from "next/server";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendance, auditLogs, employees, users } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { loadAccess } from "@/lib/access";
import { loadEmployeeOrg } from "@/lib/org";
import { computeAllForMonth } from "@/lib/salary";
import { parseReportRange, toOverviewRow, type OverviewRow } from "@/lib/salary-report";
import { buildSalaryWorkbook, type DailyLine, type ExportEmployee, type GroupBy } from "@/lib/salary-export";
import { addDays, dateKey, localParts } from "@/lib/payroll";

const GROUPS: GroupBy[] = ["company", "location", "department", "employee"];
const MAX_EMPLOYEES = 500;
const MAX_WITH_PHOTOS = 300; // each photo is ~50 KB; larger exports should be split

/**
 * Salary export (Excel). Admin only.
 *  groupBy: company | location | department | employee
 *  range:   month=YYYY-MM (a salary cycle) or from=&to= (any date range)
 *  filters: departmentId, locationId, employeeId
 *  photos=1: embed each employee's latest punch-in photo in the period
 */
export async function GET(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await loadAccess(ctx);
  if (!access.isAdmin) return NextResponse.json({ error: "Only company admins can export salary reports." }, { status: 403 });
  const settings = ctx.settings!;
  const companyId = ctx.company!.id;
  const tz = settings.timezone || "UTC";
  const params = new URL(req.url).searchParams;

  const groupBy = (GROUPS as string[]).includes(params.get("groupBy") ?? "") ? (params.get("groupBy") as GroupBy) : "company";
  const includePhotos = params.get("photos") === "1";

  const parsed = parseReportRange(params, settings, new Date());
  if (!parsed.range) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const range = parsed.range;

  const comps = await computeAllForMonth(companyId, range.year, range.month, { customPeriod: range.customPeriod });
  const ids = comps.map((c) => c.employee.id);
  const [orgMap, nameRows] = await Promise.all([
    loadEmployeeOrg(ids),
    ids.length
      ? db.select({ id: employees.id, fullName: users.fullName }).from(employees).innerJoin(users, eq(employees.userId, users.id)).where(inArray(employees.id, ids))
      : Promise.resolve([]),
  ]);
  const nameById = new Map(nameRows.map((r) => [r.id, r.fullName]));

  const deptId = params.get("departmentId");
  const locId = params.get("locationId");
  const empId = params.get("employeeId");
  const selected = comps
    .map((c) => ({
      c,
      row: toOverviewRow(
        c,
        {
          name: nameById.get(c.employee.id) ?? "",
          code: c.employee.employeeCode ?? null,
          departments: orgMap.get(c.employee.id)?.departments ?? [],
          locations: orgMap.get(c.employee.id)?.locations ?? [],
        },
        settings.lateMarksLimit
      ),
    }))
    .filter(({ row }) => !deptId || row.departments.some((d) => d.id === deptId))
    .filter(({ row }) => !locId || row.locations.some((l) => l.id === locId))
    .filter(({ row }) => !empId || row.employeeId === empId);

  const limit = includePhotos ? MAX_WITH_PHOTOS : MAX_EMPLOYEES;
  if (selected.length > limit) {
    return NextResponse.json(
      { error: `This export is limited to ${limit} employees. Filter by department, location or employee, or choose a shorter date range.` },
      { status: 400 }
    );
  }
  if (selected.length === 0) return NextResponse.json({ error: "No employees match these filters." }, { status: 400 });

  const selIds = selected.map((s) => s.row.employeeId);
  const starts = selected.map((s) => s.c.period.start.getTime());
  const ends = selected.map((s) => s.c.period.end.getTime());
  const rangeStart = new Date(Math.min(...starts));
  const rangeEnd = addDays(new Date(Math.max(...ends)), 1);

  // Day-by-day lines (only for the per-employee export, which has a sheet per person)
  const dailyByEmp = new Map<string, DailyLine[]>();
  if (groupBy === "employee") {
    const att = await db
      .select({
        employeeId: attendance.employeeId,
        workDate: attendance.workDate,
        status: attendance.status,
        punchInTime: attendance.punchInTime,
        punchOutTime: attendance.punchOutTime,
        earlyLeaveMinutes: attendance.earlyLeaveMinutes,
        overtimeMinutes: attendance.overtimeMinutes,
      })
      .from(attendance)
      .where(and(eq(attendance.companyId, companyId), inArray(attendance.employeeId, selIds), gte(attendance.workDate, rangeStart), lt(attendance.workDate, rangeEnd)))
      .orderBy(asc(attendance.workDate));
    const fmt = (d: Date | null) => {
      if (!d) return "";
      const m = localParts(d, tz).minutes; // minutes since local midnight
      return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    };
    for (const a of att) {
      const cycle = selected.find((s) => s.row.employeeId === a.employeeId)?.c.period;
      if (!cycle || a.workDate.getTime() < cycle.start.getTime() || a.workDate.getTime() > cycle.end.getTime()) continue;
      const line: DailyLine = {
        date: dateKey(a.workDate),
        weekday: new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(a.workDate),
        status: a.status,
        punchIn: fmt(a.punchInTime),
        punchOut: fmt(a.punchOutTime),
        earlyLeave: a.earlyLeaveMinutes ?? 0,
        overtime: a.overtimeMinutes ?? 0,
      };
      dailyByEmp.set(a.employeeId, [...(dailyByEmp.get(a.employeeId) ?? []), line]);
    }
  }

  // Latest punch-in photo per employee inside the period (the system stores punch photos, not profile photos)
  const photoByEmp = new Map<string, string>();
  if (includePhotos) {
    const res = await db.execute(sql`
      select distinct on (employee_id) employee_id, punch_in_photo
      from attendance
      where company_id = ${companyId}
        and employee_id = any(${selIds}::uuid[])
        and work_date >= ${rangeStart}
        and work_date < ${rangeEnd}
        and punch_in_photo is not null
      order by employee_id, work_date desc
    `);
    for (const r of res.rows as { employee_id: string; punch_in_photo: string }[]) photoByEmp.set(r.employee_id, r.punch_in_photo);
  }

  const items: ExportEmployee[] = selected.map(({ row }) => ({
    row: row as OverviewRow,
    photo: photoByEmp.get(row.employeeId) ?? null,
    daily: dailyByEmp.get(row.employeeId) ?? [],
  }));

  const generatedAt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(new Date());
  const wb = await buildSalaryWorkbook({
    companyName: ctx.company!.name,
    currency: settings.currency,
    rangeLabel: range.label,
    groupBy,
    includePhotos,
    generatedAt,
    employees: items,
  });

  await db.insert(auditLogs).values({
    companyId,
    actorId: ctx.user.id,
    action: "salary.export",
    entity: "salary",
    details: { range: range.key, groupBy, employees: items.length, photos: includePhotos, departmentId: deptId, locationId: locId, employeeId: empId },
  });

  const buf = await wb.xlsx.writeBuffer();
  const safeName = `salary-${groupBy}-${range.key}${includePhotos ? "-photos" : ""}.xlsx`;
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "no-store",
    },
  });
}
