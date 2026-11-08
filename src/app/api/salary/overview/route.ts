import { NextResponse } from "next/server";
import { inArray, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, users } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { loadAccess } from "@/lib/access";
import { CURRENCY as CURRENCY_CODE } from "@/lib/utils";
import { loadEmployeeOrg } from "@/lib/org";
import { computeAllForMonth } from "@/lib/salary";
import { parseReportRange, toOverviewRow, totalsOf, type OverviewRow } from "@/lib/salary-report";
import { dateKey, recentCycles, localWorkDate } from "@/lib/payroll";

/**
 * Company-wide salary overview for one salary cycle (or a custom date range). Admin only.
 * Filters: departmentId, locationId, employeeId. Totals are returned for the filtered list and for the company.
 */
export async function GET(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await loadAccess(ctx);
  if (!access.isAdmin) return NextResponse.json({ error: "Only company admins can view company salary totals." }, { status: 403 });
  const settings = ctx.settings!;
  const companyId = ctx.company!.id;
  const params = new URL(req.url).searchParams;

  const parsed = parseReportRange(params, settings, new Date());
  if (!parsed.range) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const range = parsed.range;

  const comps = await computeAllForMonth(companyId, range.year, range.month, { customPeriod: range.customPeriod });
  const ids = comps.map((c) => c.employee.id);
  const [orgMap, nameRows] = await Promise.all([
    loadEmployeeOrg(ids),
    ids.length
      ? db
          .select({ id: employees.id, fullName: users.fullName })
          .from(employees)
          .innerJoin(users, eq(employees.userId, users.id))
          .where(inArray(employees.id, ids))
      : Promise.resolve([]),
  ]);
  const nameById = new Map(nameRows.map((r) => [r.id, r.fullName]));

  const allRows: OverviewRow[] = comps.map((c) =>
    toOverviewRow(
      c,
      {
        name: nameById.get(c.employee.id) ?? "",
        code: c.employee.employeeCode ?? null,
        departments: orgMap.get(c.employee.id)?.departments ?? [],
        locations: orgMap.get(c.employee.id)?.locations ?? [],
      },
      settings.lateMarksLimit
    )
  );

  const deptId = params.get("departmentId");
  const locId = params.get("locationId");
  const empId = params.get("employeeId");
  const rows = allRows
    .filter((r) => !deptId || r.departments.some((d) => d.id === deptId))
    .filter((r) => !locId || r.locations.some((l) => l.id === locId))
    .filter((r) => !empId || r.employeeId === empId);

  const cycles = recentCycles(localWorkDate(new Date(), settings.timezone || "UTC"), settings.salaryCycleStartDay, 12).map((k) => ({
    key: k.key,
    start: dateKey(k.start),
    end: dateKey(k.end),
  }));

  return NextResponse.json({
    range: {
      key: range.key,
      label: range.label,
      start: range.customPeriod ? dateKey(range.customPeriod.start) : null,
      end: range.customPeriod ? dateKey(range.customPeriod.end) : null,
      isCustom: !!range.customPeriod,
    },
    cycles,
    currency: CURRENCY_CODE,
    lateMarksLimit: settings.lateMarksLimit,
    rows,
    totals: totalsOf(rows),
    companyTotals: totalsOf(allRows),
  });
}
