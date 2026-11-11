import ExcelJS from "exceljs";
import { totalsOf, type OverviewRow } from "@/lib/salary-report";

export type GroupBy = "company" | "location" | "department" | "employee";

export interface DailyLine {
  date: string;
  weekday: string;
  status: string;
  punchIn: string;
  punchOut: string;
  earlyLeave: number;
  overtime: number;
}

export interface ExportEmployee {
  row: OverviewRow;
  photo: string | null; // data:image/jpeg;base64,... (latest punch-in photo in the period), if requested
  daily: DailyLine[];
}

export interface ExportOptions {
  companyName: string;
  currency: string;
  rangeLabel: string;
  groupBy: GroupBy;
  includePhotos: boolean;
  generatedAt: string;
  employees: ExportEmployee[];
}

const MONEY = '"₹"#,##0.00';
const HEADER_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF4F46E5" } };
const TOTAL_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFEEF2FF" } };

interface Col {
  header: string;
  width: number;
  value: (r: OverviewRow) => string | number;
  money?: boolean;
}

function detailColumns(currency: string): Col[] {
  return [
    { header: "Code", width: 10, value: (r) => r.code ?? "" },
    { header: "Employee", width: 24, value: (r) => r.name },
    { header: "Designation", width: 16, value: (r) => r.designation ?? "" },
    { header: "Departments", width: 20, value: (r) => r.departments.map((d) => d.name).join(", ") },
    { header: "Locations", width: 20, value: (r) => r.locations.map((l) => l.name).join(", ") },
    { header: "Status", width: 11, value: (r) => r.status },
    { header: `Gross basic (${currency})`, width: 15, value: (r) => r.gross, money: true },
    { header: "Absent days", width: 10, value: (r) => r.absentDays },
    { header: "Absent deduction", width: 14, value: (r) => r.absentDeduction, money: true },
    { header: "Late days", width: 9, value: (r) => r.lateDays },
    { header: "Late deduction", width: 13, value: (r) => r.lateDeduction, money: true },
    { header: "Half days", width: 9, value: (r) => r.halfDays },
    { header: "Half-day deduction", width: 15, value: (r) => r.halfDayDeduction, money: true },
    { header: "Leave days", width: 9, value: (r) => r.leaveDays },
    { header: "Unpaid leave days", width: 11, value: (r) => r.unpaidLeaveDays },
    { header: "Leave deduction", width: 13, value: (r) => r.leaveDeduction, money: true },
    { header: "Early-leave deduction", width: 15, value: (r) => r.earlyLeaveDeduction, money: true },
    { header: "Other deductions", width: 14, value: (r) => r.otherDeductions, money: true },
    { header: "Total deductions", width: 14, value: (r) => r.deductions, money: true },
    { header: "Additions", width: 12, value: (r) => r.additions, money: true },
    { header: "Overtime (min)", width: 11, value: (r) => r.overtimeMinutes },
    { header: "Overtime pay", width: 12, value: (r) => r.overtimePay, money: true },
    { header: "Extra pay", width: 12, value: (r) => r.extraPay, money: true },
    { header: "Salary date", width: 12, value: (r) => r.salaryDate },
    { header: "Delay (days)", width: 10, value: (r) => r.delayDays },
    { header: "Disburse on", width: 12, value: (r) => r.disburseOn },
    { header: "Held (earlier rule)", width: 14, value: (r) => r.holds, money: true },
    { header: "Net payable", width: 14, value: (r) => r.net, money: true },
    {
      header: "Flags",
      width: 22,
      value: (r) => [r.flags.excessiveLeave ? "Excessive leave" : "", r.flags.lateMarks ? "Late marks" : ""].filter(Boolean).join(", "),
    },
  ];
}

const PHOTO_COL_WIDTH = 16;
const PHOTO_PX = 92;

/** Excel sheet names: max 31 chars, no []:*?/\ and unique within the workbook. */
function sheetName(raw: string, used: Set<string>): string {
  const base = (raw.replace(/[\[\]:*?/\\]/g, " ").trim() || "Sheet").slice(0, 28);
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) name = `${base.slice(0, 26)} ${n++}`;
  used.add(name.toLowerCase());
  return name;
}

function addPhoto(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, dataUrl: string | null, col: number, row: number) {
  const m = dataUrl?.match(/^data:image\/(jpeg|png);base64,(.+)$/);
  if (!m) return;
  const id = wb.addImage({ base64: m[2], extension: m[1] === "png" ? "png" : "jpeg" });
  ws.addImage(id, { tl: { col: col + 0.05, row: row - 1 + 0.05 }, ext: { width: PHOTO_PX, height: PHOTO_PX } });
}

/** Writes a detail table (one row per employee) with a totals row. Returns the next free row number. */
function writeDetailTable(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  items: ExportEmployee[],
  o: ExportOptions,
  startRow: number
): number {
  const cols = detailColumns(o.currency);
  const allCols: Col[] = cols;
  const photoCol = o.includePhotos ? allCols.length : -1;

  const header = ws.getRow(startRow);
  allCols.forEach((c, i) => {
    header.getCell(i + 1).value = c.header;
  });
  if (photoCol >= 0) header.getCell(photoCol + 1).value = "Photo (latest punch-in)";
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = HEADER_FILL;
  header.height = 30;
  header.alignment = { wrapText: true, vertical: "middle" };

  allCols.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));
  if (photoCol >= 0) ws.getColumn(photoCol + 1).width = PHOTO_COL_WIDTH;

  let r = startRow + 1;
  for (const it of items) {
    const row = ws.getRow(r);
    allCols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = c.value(it.row);
      if (c.money) cell.numFmt = MONEY;
    });
    if (photoCol >= 0) {
      row.height = 74;
      addPhoto(wb, ws, it.photo, photoCol, r);
    }
    r++;
  }

  // totals
  const t = totalsOf(items.map((i) => i.row));
  const totalRow = ws.getRow(r);
  totalRow.getCell(1).value = "TOTAL";
  totalRow.getCell(2).value = `${items.length} employee(s)`;
  const totalFor: Record<string, number> = {
    "Gross basic": t.gross,
    "Total deductions": t.deductions,
    "Additions": items.reduce((s, i) => s + i.row.additions, 0),
    "Net payable": t.net,
    "Held (earlier rule)": t.holds,
  };
  allCols.forEach((c, i) => {
    const cell = totalRow.getCell(i + 1);
    const key = Object.keys(totalFor).find((k) => c.header.startsWith(k));
    if (key) {
      cell.value = Number(totalFor[key].toFixed(2));
      cell.numFmt = MONEY;
    }
  });
  totalRow.font = { bold: true };
  totalRow.eachCell((cell) => (cell.fill = TOTAL_FILL));
  return r + 1;
}

/** One sheet summarising the company, with a group table when grouping by department or location. */
function writeSummary(wb: ExcelJS.Workbook, o: ExportOptions, used: Set<string>) {
  const ws = wb.addWorksheet(sheetName("Summary", used), { views: [{ showGridLines: false }] });
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 20;
  ws.getColumn(3).width = 16;
  ws.getColumn(4).width = 18;
  ws.getColumn(5).width = 18;

  ws.getCell("A1").value = `Salary report: ${o.companyName}`;
  ws.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF312E81" } };
  ws.getCell("A2").value = `Period: ${o.rangeLabel}`;
  ws.getCell("A3").value = `Generated: ${o.generatedAt}`;
  ws.getCell("A4").value = `Grouping: ${({ company: "Company-wide", location: "By location", department: "By department", employee: "By employee" } as const)[o.groupBy]}`;

  const t = totalsOf(o.employees.map((e) => e.row));
  const kpis: [string, number | string, boolean][] = [
    [`Total payable (gross basic, ${o.currency})`, t.gross, true],
    [`Total deductions (${o.currency})`, t.deductions, true],
    [`Additions, overtime and extra pay (${o.currency})`, t.credits, true],
    [`Held under the earlier rule (${o.currency})`, t.holds, true],
    [`Net payable balance (${o.currency})`, t.net, true],
    ["Employees", t.employees, false],
    ["Late days", t.lateDays, false],
    ["Half days", t.halfDays, false],
    ["Absent days", t.absentDays, false],
    ["Leave days", t.leaveDays, false],
    ["Employees flagged (excessive leave or late marks)", t.flagged, false],
  ];
  let r = 6;
  ws.getRow(r).values = ["Overview", "Value"];
  ws.getRow(r).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(r).getCell(1).fill = HEADER_FILL;
  ws.getRow(r).getCell(2).fill = HEADER_FILL;
  r++;
  for (const [label, value, money] of kpis) {
    const row = ws.getRow(r++);
    row.getCell(1).value = label;
    row.getCell(2).value = value;
    if (money) row.getCell(2).numFmt = MONEY;
    if (label.startsWith("Net payable")) {
      row.font = { bold: true };
      row.getCell(2).font = { bold: true, color: { argb: "FF047857" } };
    }
  }
  r++;
  ws.getRow(r).values = ["Reconciliation", ""];
  ws.getRow(r).font = { bold: true };
  r++;
  ws.getRow(r).values = [
    "Gross − deductions + additions (salary is paid in full on each disbursement date)",
    Number((t.gross - t.deductions + t.credits - t.holds).toFixed(2)),
  ];
  ws.getRow(r).getCell(2).numFmt = MONEY;
  r++;
  ws.getRow(r).values = ["Net payable (as calculated, never below zero per employee)", t.net];
  ws.getRow(r).getCell(2).numFmt = MONEY;
  r += 2;

  if (o.groupBy === "department" || o.groupBy === "location") {
    const groups = new Map<string, OverviewRow[]>();
    for (const e of o.employees) {
      const names = o.groupBy === "department" ? e.row.departments.map((d) => d.name) : e.row.locations.map((l) => l.name);
      const keys = names.length ? names : [o.groupBy === "department" ? "No department" : "No location"];
      for (const k of keys) groups.set(k, [...(groups.get(k) ?? []), e.row]);
    }
    const head = ws.getRow(r);
    head.values = [o.groupBy === "department" ? "Department" : "Location", "Employees", `Gross (${o.currency})`, `Deductions (${o.currency})`, `Net payable (${o.currency})`];
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    [1, 2, 3, 4, 5].forEach((c) => (head.getCell(c).fill = HEADER_FILL));
    r++;
    for (const [name, rows] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const g = totalsOf(rows);
      const row = ws.getRow(r++);
      row.values = [name, g.employees, g.gross, g.deductions, g.net];
      row.getCell(3).numFmt = MONEY;
      row.getCell(4).numFmt = MONEY;
      row.getCell(5).numFmt = MONEY;
    }
    r++;
    ws.getCell(`A${r}`).value = "Someone who belongs to several departments or locations appears in each one, so group totals can add up to more than the company total.";
    ws.getCell(`A${r}`).font = { italic: true, color: { argb: "FF64748B" } };
  }
  ws.getCell(`A${r + 2}`).value = "Deductions include absent days, late arrivals, half days, unpaid leave, early leave and other deductions. Net payable is never below zero for any employee.";
  ws.getCell(`A${r + 2}`).font = { italic: true, color: { argb: "FF64748B" } };
}

function writeEmployeeSheet(wb: ExcelJS.Workbook, e: ExportEmployee, o: ExportOptions, used: Set<string>) {
  const ws = wb.addWorksheet(sheetName(`${e.row.code ? e.row.code + " " : ""}${e.row.name}`, used));
  const r0 = e.row;
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 18;
  for (let c = 3; c <= 9; c++) ws.getColumn(c).width = 14;

  ws.getCell("A1").value = r0.name;
  ws.getCell("A1").font = { bold: true, size: 16, color: { argb: "FF312E81" } };
  const info: [string, string][] = [
    ["Employee code", r0.code ?? "—"],
    ["Designation", r0.designation ?? "—"],
    ["Departments", r0.departments.map((d) => d.name).join(", ") || "—"],
    ["Work locations", r0.locations.map((l) => l.name).join(", ") || "—"],
    ["Period", o.rangeLabel],
    ["Salary status", r0.status],
    ["Salary date", r0.salaryDate],
    ["Disburses on", r0.disburseOn + (r0.delayDays > 0 ? ` (delayed ${r0.delayDays} day(s) for unapproved leave)` : "")],
  ];
  info.forEach(([k, v], i) => {
    ws.getCell(`A${i + 2}`).value = k;
    ws.getCell(`A${i + 2}`).font = { bold: true, color: { argb: "FF475569" } };
    ws.getCell(`B${i + 2}`).value = v;
  });
  if (o.includePhotos) {
    ws.getColumn(9).width = PHOTO_COL_WIDTH;
    addPhoto(wb, ws, e.photo, 8, 2);
    ws.getCell("I1").value = "Latest punch-in photo";
    ws.getCell("I1").font = { bold: true, size: 9, color: { argb: "FF64748B" } };
  }

  let r = 12;
  ws.getRow(r).values = ["Salary breakdown", `Amount (${o.currency})`];
  ws.getRow(r).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(r).getCell(1).fill = HEADER_FILL;
  ws.getRow(r).getCell(2).fill = HEADER_FILL;
  r++;
  const lines: [string, number][] = [
    ["Gross basic salary", r0.gross],
    ["Absent deduction", -r0.absentDeduction],
    ["Late deduction", -r0.lateDeduction],
    ["Half-day deduction", -r0.halfDayDeduction],
    ["Leave deduction (unpaid leave)", -r0.leaveDeduction],
    ["Early-leave deduction", -r0.earlyLeaveDeduction],
    ["Other deductions", -r0.otherDeductions],
    ["Additions", r0.additions],
    ["Overtime pay", r0.overtimePay],
    ["Extra pay (unused comp-off)", r0.extraPay],
    ["Held under the earlier rule", -r0.holds],
    ["Net payable", r0.net],
  ];
  for (const [label, value] of lines) {
    const row = ws.getRow(r++);
    row.getCell(1).value = label;
    row.getCell(2).value = value;
    row.getCell(2).numFmt = MONEY;
    if (label === "Net payable") {
      row.font = { bold: true };
      row.getCell(2).font = { bold: true, color: { argb: "FF047857" } };
    }
  }
  r++;

  ws.getRow(r).values = ["Day-by-day attendance"];
  ws.getRow(r).font = { bold: true };
  r++;
  const dh = ws.getRow(r);
  dh.values = ["Date", "Day", "Status", "Punch in", "Punch out", "Early leave (min)", "Overtime (min)"];
  dh.font = { bold: true, color: { argb: "FFFFFFFF" } };
  for (let c = 1; c <= 7; c++) dh.getCell(c).fill = HEADER_FILL;
  r++;
  if (e.daily.length === 0) {
    ws.getCell(`A${r}`).value = "No attendance recorded in this period.";
    ws.getCell(`A${r}`).font = { italic: true, color: { argb: "FF64748B" } };
  }
  for (const d of e.daily) {
    const row = ws.getRow(r++);
    row.values = [d.date, d.weekday, d.status.replace("_", " "), d.punchIn, d.punchOut, d.earlyLeave, d.overtime];
  }
}

/** Builds the whole salary workbook for the chosen grouping. */
export async function buildSalaryWorkbook(o: ExportOptions): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TimeTrack Pro";
  const used = new Set<string>();
  writeSummary(wb, o, used);

  if (o.groupBy === "company") {
    const ws = wb.addWorksheet(sheetName("Salary detail", used));
    writeDetailTable(wb, ws, o.employees, o, 1);
    ws.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];
  } else if (o.groupBy === "department" || o.groupBy === "location") {
    const groups = new Map<string, ExportEmployee[]>();
    for (const e of o.employees) {
      const names = o.groupBy === "department" ? e.row.departments.map((d) => d.name) : e.row.locations.map((l) => l.name);
      const keys = names.length ? names : [o.groupBy === "department" ? "No department" : "No location"];
      for (const k of keys) groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    for (const [name, items] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const ws = wb.addWorksheet(sheetName(name, used));
      ws.getCell("A1").value = `${o.groupBy === "department" ? "Department" : "Location"}: ${name}`;
      ws.getCell("A1").font = { bold: true, size: 13, color: { argb: "FF312E81" } };
      ws.getCell("A2").value = `Period: ${o.rangeLabel}`;
      writeDetailTable(wb, ws, items, o, 4);
      ws.views = [{ state: "frozen", ySplit: 4, xSplit: 2 }];
    }
  } else {
    for (const e of o.employees) writeEmployeeSheet(wb, e, o, used);
  }
  return wb;
}
