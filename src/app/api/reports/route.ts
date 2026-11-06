import { NextResponse } from "next/server";
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { attendance, employees, leaveRequests, salaryRecords, users } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { formatDate, formatTime, workingHours } from "@/lib/utils";
import { dateKey, localWorkDate } from "@/lib/payroll";
import { loadEmployeeOrg } from "@/lib/org";

type Period = "daily" | "weekly" | "monthly" | "yearly";
type Report = "attendance" | "late" | "leave" | "salary" | "deduction";

function getRange(period: Period, dateStr: string | null, tz: string) {
  const parsed = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? new Date(`${dateStr}T00:00:00Z`) : null;
  const base = parsed && !Number.isNaN(parsed.getTime()) ? parsed : localWorkDate(new Date(), tz);
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  let start: Date;
  let end: Date;
  if (period === "daily") {
    start = new Date(Date.UTC(year, month, base.getUTCDate()));
    end = new Date(Date.UTC(year, month, base.getUTCDate() + 1));
  } else if (period === "weekly") {
    const day = base.getUTCDay();
    const diff = day === 0 ? 6 : day - 1; // Monday start
    const monday = new Date(Date.UTC(year, month, base.getUTCDate() - diff));
    start = monday;
    end = new Date(monday.getTime() + 7 * 86400000);
  } else if (period === "monthly") {
    start = new Date(Date.UTC(year, month, 1));
    end = new Date(Date.UTC(year, month + 1, 1));
  } else {
    start = new Date(Date.UTC(year, 0, 1));
    end = new Date(Date.UTC(year + 1, 0, 1));
  }
  return { start, end, year, month };
}

export async function GET(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Reports expose company-wide attendance and salary data: admins and managers only.
  if (ctx.user.role !== "company_admin" && ctx.user.role !== "manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const companyId = ctx.company!.id;
  const tz = ctx.settings?.timezone ?? "UTC";
  const isAdmin = ctx.user.role === "company_admin";

  const url = new URL(req.url);
  const period = (url.searchParams.get("period") || "monthly") as Period;
  const report = (url.searchParams.get("report") || "attendance") as Report;
  const dateStr = url.searchParams.get("date");
  const employeeId = url.searchParams.get("employeeId");
  const departmentId = url.searchParams.get("departmentId");
  const fmtParam = url.searchParams.get("format");
  const format = fmtParam === "csv" ? "csv" : fmtParam === "xlsx" ? "xlsx" : "json";
  const { start, end, year, month } = getRange(period, dateStr, tz);

  const empRows = await db
    .select()
    .from(employees)
    .innerJoin(users, eq(employees.userId, users.id))
    .where(eq(employees.companyId, companyId));
  const scopeIds = isAdmin
    ? null
    : new Set(
        empRows
          .filter((r) => r.employees.managerId === ctx.employee?.id || r.employees.id === ctx.employee?.id)
          .map((r) => r.employees.id)
      );
  if (!isAdmin && (report === "salary" || report === "deduction")) {
    return NextResponse.json({ error: "Salary reports are available to company admins only." }, { status: 403 });
  }
  const orgByEmployee = await loadEmployeeOrg(empRows.map((r) => r.employees.id));
  const deptNames = (id: string) => orgByEmployee.get(id)?.departments.map((d) => d.name).join(", ") ?? "";
  const inDepartment = (id: string) =>
    !departmentId || !!orgByEmployee.get(id)?.departments.some((d) => d.id === departmentId);
  const inScope = (id: string) => (!scopeIds || scopeIds.has(id)) && inDepartment(id);
  const empById = new Map(empRows.map((r) => [r.employees.id, r.users]));

  let rows: Record<string, unknown>[] = [];

  if (report === "attendance" || report === "late") {
    const records = await db
      .select()
      .from(attendance)
      .where(and(eq(attendance.companyId, companyId), gte(attendance.workDate, start), lt(attendance.workDate, end)))
      .orderBy(asc(attendance.workDate));
    const filtered = records.filter((r) => inScope(r.employeeId) && (!employeeId || r.employeeId === employeeId));
    for (const r of filtered) {
      const u = empById.get(r.employeeId);
      const isLate = r.status === "late" || r.status === "half_day";
      if (report === "late" && !isLate) continue;
      rows.push({
        Date: formatDate(r.workDate),
        Employee: u?.fullName ?? r.employeeId,
        Department: deptNames(r.employeeId),
        "Punch In": formatTime(r.punchInTime),
        "Punch Out": formatTime(r.punchOutTime),
        Hours: workingHours(r.punchInTime, r.punchOutTime),
        Status: r.status,
        "Early Leave (min)": r.earlyLeaveMinutes,
        "Overtime (min)": r.overtimeMinutes,
        "Manual Edit": r.isManual ? "Yes" : "No",
      });
    }
  } else if (report === "leave") {
    const records = await db
      .select()
      .from(leaveRequests)
      .where(and(eq(leaveRequests.companyId, companyId), lt(leaveRequests.startDate, end), gte(leaveRequests.endDate, start)))
      .orderBy(desc(leaveRequests.createdAt));
    const filtered = records.filter((r) => inScope(r.employeeId) && (!employeeId || r.employeeId === employeeId));
    for (const r of filtered) {
      const u = empById.get(r.employeeId);
      rows.push({
        Employee: u?.fullName ?? r.employeeId,
        Department: deptNames(r.employeeId),
        Type: r.leaveType,
        "Start Date": formatDate(r.startDate),
        "End Date": formatDate(r.endDate),
        Days: r.days,
        Status: r.status,
        Reason: r.reason ?? "",
      });
    }
  } else {
    // salary / deduction
    const records = await db
      .select()
      .from(salaryRecords)
      .where(
        and(
          eq(salaryRecords.companyId, companyId),
          eq(salaryRecords.year, year),
          ...(period === "yearly" ? [] : [eq(salaryRecords.month, month + 1)])
        )
      )
      .orderBy(asc(salaryRecords.year), asc(salaryRecords.month));
    const filtered = records.filter((r) => inScope(r.employeeId) && (!employeeId || r.employeeId === employeeId));
    for (const r of filtered) {
      const u = empById.get(r.employeeId);
      rows.push({
        Employee: u?.fullName ?? r.employeeId,
        Department: deptNames(r.employeeId),
        Month: `${r.year}-${String(r.month).padStart(2, "0")}`,
        Cycle: r.periodStart && r.periodEnd ? `${dateKey(r.periodStart)} to ${dateKey(r.periodEnd)}` : "",
        Status: r.status,
        "Basic Salary": r.basicSalary,
        "Attendance Salary": r.attendanceSalary,
        "Overtime Pay": r.overtimePay,
        "Bonuses / Allowances": r.additions.reduce((s, a) => s + Number(a.amount), 0),
        "Late Deduction": r.lateDeduction,
        "Early-Leave Deduction": r.earlyLeaveDeduction,
        "Half-Day Deduction": r.halfDayDeduction,
        "Leave Deduction": r.leaveDeduction,
        "Salary Hold": r.salaryHoldAmount,
        "Other Deductions": r.otherDeductions.reduce((s, d) => s + Number(d.amount), 0),
        "Total Deductions": r.totalDeductions,
        "Net Payable": r.netPayable,
      });
    }
  }

  if (format === "xlsx") {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = ctx.company?.name ?? "TimeTrack";
    const ws = wb.addWorksheet(report.slice(0, 31));
    const headers = rows.length ? Object.keys(rows[0]) : ["No data"];
    ws.addRow(headers);
    for (const r of rows) ws.addRow(headers.map((h) => (r[h] ?? "") as string | number));
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((col) => { col.width = 18; });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(buf as ArrayBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${report}-report.xlsx"`,
      },
    });
  }

  if (format === "csv") {
    if (rows.length === 0) {
      return new NextResponse("No data", { headers: { "Content-Type": "text/csv" } });
    }
    const headers = Object.keys(rows[0]);
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
    return new NextResponse(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${report}-report.csv"` },
    });
  }

  return NextResponse.json({ period, report, start, end, count: rows.length, rows });
}