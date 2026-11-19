import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { countPayments, EXPORT_LIMIT, exportRows } from "@/lib/payments-admin";
import { displayStatus, istDateTime, parsePaymentFilters, toCsv } from "@/lib/payments-report";

const COLUMNS = [
  { key: "date", header: "Date & time (IST)" },
  { key: "company", header: "Company" },
  { key: "companyCode", header: "Company code" },
  { key: "plan", header: "Plan" },
  { key: "cycle", header: "Billing cycle" },
  { key: "amount", header: "Amount (INR)" },
  { key: "refunded", header: "Refunded (INR)" },
  { key: "net", header: "Net (INR)" },
  { key: "status", header: "Status" },
  { key: "method", header: "Payment method" },
  { key: "provider", header: "Gateway" },
  { key: "paymentId", header: "Razorpay payment ID" },
  { key: "orderId", header: "Order ID" },
  { key: "initiatedBy", header: "Initiated by" },
];

/**
 * Platform owner only. The filtered transactions as a CSV file for accounting (opens directly in Excel).
 * Takes the same filters as the list. Refuses very large exports so the file stays manageable: narrow the range instead.
 */
export async function GET(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const now = new Date();
  const filters = parsePaymentFilters(new URL(req.url).searchParams, now);
  if ("error" in filters) return NextResponse.json({ error: filters.error }, { status: 400 });

  const total = await countPayments(filters);
  if (total > EXPORT_LIMIT) {
    return NextResponse.json(
      { error: `This export has ${total.toLocaleString("en-IN")} transactions. Narrow the date range to export up to ${EXPORT_LIMIT.toLocaleString("en-IN")} at a time.` },
      { status: 413 }
    );
  }

  const rows = await exportRows(filters, EXPORT_LIMIT);
  const records = rows.map((r) => {
    const p = r.payment;
    const amount = Number(p.amount);
    const refunded = Number(p.refundedAmount);
    return {
      date: istDateTime(p.paidAt ?? p.createdAt),
      company: r.companyName,
      companyCode: r.companyCode,
      plan: r.planName ?? "Plan removed",
      cycle: `${p.months} ${p.months === 1 ? "month" : "months"}`,
      amount: amount.toFixed(2),
      refunded: refunded.toFixed(2),
      net: (amount - refunded).toFixed(2),
      status: displayStatus(p.status).label,
      method: p.paymentMethod ?? "",
      provider: p.provider,
      paymentId: p.providerPaymentId ?? "",
      orderId: p.providerOrderId ?? "",
      initiatedBy: r.createdBy ?? "",
    };
  });

  const stamp = istDateTime(now).slice(0, 10);
  // A byte-order mark makes Excel read the rupee sign and any non-English company names correctly.
  const body = `\uFEFF${toCsv(COLUMNS, records)}\r\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="razorpay-payments-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
