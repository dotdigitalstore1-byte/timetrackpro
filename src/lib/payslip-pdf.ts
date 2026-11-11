import { formatNumber } from "@/lib/utils";

/** The figures a payslip shows. Mirrors the breakdown returned by /api/salary and /api/salary/slips/[id]. */
export interface SlipBreakdown {
  basicSalary: number;
  attendanceSalary: number;
  absentDays: number;
  lateDays: number;
  lateDeduction: number;
  halfDays: number;
  halfDayDeduction: number;
  earlyLeaveDays: number;
  earlyLeaveDeduction: number;
  unpaidLeaveDays: number;
  leaveDeduction: number;
  holidayDeductionDays: number;
  holidayDeduction: number;
  overtimePay: number;
  overtimeMinutes: number;
  extraPay: number;
  additions: { label: string; amount: number }[];
  additionsTotal: number;
  otherDeductions: { label: string; amount: number }[];
  totalDeductions: number;
  salaryHoldDays: number;
  salaryHoldAmount: number;
  netBeforeHold: number;
  netPayable: number;
  ledger?: { date: string | null; kind: string; reason: string; amount: number }[] | null; // day-wise deduction log
}

export interface SlipCompany {
  name: string;
  legalName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  taxId: string;
  logoDataUrl: string | null;
}

export interface SlipPayload {
  company: SlipCompany;
  employee: { name: string; code: string | null; designation: string | null };
  provisional?: boolean;
  asOf?: string | null;
  period: { start: string; end: string };
  salaryDate: string;
  disbursementDate: string;
  status: string;
  availableUntil: string | null;
  breakdown: SlipBreakdown;
}

/**
 * Builds the payslip PDF in the browser. The PDF uses "Rs." rather than the ₹ sign because the
 * standard PDF fonts do not include the rupee glyph.
 */
export async function downloadPayslipPdf(slip: SlipPayload): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const b = slip.breakdown;
  const money = (n: number) => `Rs. ${formatNumber(n)}`;

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const co = slip.company;
  const pageWidth = doc.internal.pageSize.getWidth();
  const textX = co.logoDataUrl && /^data:image\/(png|jpeg);/.test(co.logoDataUrl) ? 42 : 14;

  // Company header: logo (PNG or JPEG only), name, legal name, address, contacts and tax ID.
  if (textX === 42) {
    const format = co.logoDataUrl!.startsWith("data:image/png") ? "PNG" : "JPEG";
    doc.addImage(co.logoDataUrl!, format, 14, 10, 24, 24);
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(co.name || "Company", textX, 17);
  let y = 23;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  if (co.legalName && co.legalName !== co.name) {
    doc.text(co.legalName, textX, y);
    y += 4.5;
  }
  if (co.address) {
    const lines = doc.splitTextToSize(co.address, pageWidth - textX - 14) as string[];
    doc.text(lines, textX, y);
    y += 4.5 * lines.length;
  }
  const contacts = [co.phone, co.email, co.website].filter(Boolean).join("  ·  ");
  if (contacts) {
    doc.text(contacts, textX, y);
    y += 4.5;
  }
  if (co.taxId) {
    doc.text(`GSTIN / PAN / Reg. no.: ${co.taxId}`, textX, y);
    y += 4.5;
  }

  const titleY = Math.max(y + 5, 40);
  doc.setDrawColor(203, 213, 225);
  doc.line(14, titleY - 5, pageWidth - 14, titleY - 5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(slip.provisional ? "Salary Slip (Provisional)" : "Salary Slip", 14, titleY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Employee: ${slip.employee.name}${slip.employee.code ? ` (${slip.employee.code})` : ""}`, 14, titleY + 6);
  doc.text(`Designation: ${slip.employee.designation ?? "-"}`, 14, titleY + 11);
  doc.text(`Pay period: ${slip.period.start} to ${slip.period.end}${slip.provisional ? " (cycle still running)" : ""}`, 14, titleY + 16);
  const shortDate = (d: string | null) =>
    d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "-";
  const delayed = b.salaryHoldDays > 0;
  doc.text(`Salary date: ${shortDate(slip.salaryDate)}${delayed ? `   Disburses on: ${shortDate(slip.disbursementDate)} (delayed ${b.salaryHoldDays} day(s), unapproved leave)` : ""}`, 14, titleY + 21);

  const section = (title: string) => [
    { content: title, colSpan: 2, styles: { fontStyle: "bold" as const, fillColor: [238, 242, 255] as [number, number, number] } },
  ];
  const total = (label: string, value: string) => [
    { content: label, styles: { fontStyle: "bold" as const } },
    { content: value, styles: { fontStyle: "bold" as const, halign: "right" as const } },
  ];

  const earnings: string[][] = [];
  earnings.push(["Monthly basic salary", money(b.basicSalary)]);
  const absentDeduction = Math.max(0, b.basicSalary - b.attendanceSalary);
  if (absentDeduction > 0) earnings.push([`Unpaid absences (${b.absentDays} day(s))`, `- ${money(absentDeduction)}`]);
  if (b.overtimePay > 0) earnings.push([`Overtime (${formatNumber(b.overtimeMinutes / 60, 1)} h)`, `+ ${money(b.overtimePay)}`]);
  if (b.extraPay > 0) earnings.push(["Extra pay for unused comp-off", `+ ${money(b.extraPay)}`]);
  for (const a of b.additions) earnings.push([a.label, `+ ${money(a.amount)}`]);
  const grossEarnings = b.attendanceSalary + b.overtimePay + b.extraPay + b.additionsTotal;

  const deductions: string[][] = [];
  if (b.lateDeduction > 0) deductions.push([`Late attendance (${b.lateDays} day(s))`, `- ${money(b.lateDeduction)}`]);
  if (b.earlyLeaveDeduction > 0) deductions.push([`Early leave (${b.earlyLeaveDays} day(s))`, `- ${money(b.earlyLeaveDeduction)}`]);
  if (b.halfDayDeduction > 0) deductions.push([`Half day(s) (${b.halfDays})`, `- ${money(b.halfDayDeduction)}`]);
  if (b.leaveDeduction > 0) deductions.push([`Approved leave, unpaid (${b.unpaidLeaveDays} day(s))`, `- ${money(b.leaveDeduction)}`]);
  if (b.holidayDeduction > 0) deductions.push([`Sunday / holiday pay cut (${b.holidayDeductionDays} day(s))`, `- ${money(b.holidayDeduction)}`]);
  for (const d of b.otherDeductions) deductions.push([d.label, `- ${money(d.amount)}`]);

  // One line per day that cost money, with the reason. Lines for days covered by comp-off show no deduction.
  const dayLines: unknown[][] = (b.ledger ?? []).map((l) => [
    `${shortDate(l.date)}  ·  ${l.reason}`,
    l.amount > 0 ? `- ${money(l.amount)}` : "No deduction",
  ]);

  const body: unknown[][] = [
    section("Earnings"),
    ...earnings,
    total("Total earnings", money(grossEarnings)),
    section("Deductions"),
    ...(deductions.length ? deductions : [["No deductions this cycle", "Rs. 0.00"]]),
    total("Total deductions", `- ${money(b.totalDeductions)}`),
    ...(dayLines.length ? [section("Day-wise deductions (with unpaid absences)"), ...dayLines] : []),
    section("Summary"),
    ["Net after deductions", money(b.netBeforeHold)],
  ];
  if (b.salaryHoldAmount > 0) body.push(["Held under the earlier rule (temporary)", `- ${money(b.salaryHoldAmount)}`]);
  body.push(total("Payable now", money(b.netPayable)));

  autoTable(doc, {
    startY: titleY + 27,
    head: [["Particulars", "Amount"]],
    body: body as never,
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [79, 70, 229] },
    columnStyles: { 1: { halign: "right" } },
    theme: "grid",
  });

  doc.setFontSize(8);
  doc.setTextColor(120);
  const note = slip.availableUntil
    ? `Available for download until ${new Date(slip.availableUntil).toLocaleDateString("en-IN")}. `
    : "";
  const provisionalNote = slip.provisional
    ? `Provisional: the cycle was still running. Figures are as of ${slip.asOf ?? "the approval date"}. The final slip replaces this one once the cycle is finalized. `
    : "";
  doc.text(`${provisionalNote}${note}Amounts in Indian Rupees. This is a computer-generated salary slip.`, 14, 285);
  doc.save(`payslip-${slip.period.start}-to-${slip.period.end}.pdf`);
}
