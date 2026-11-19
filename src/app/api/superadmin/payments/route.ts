import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { listPayments, listPlansForFilter, paymentSummary, revenueTrend } from "@/lib/payments-admin";
import { parsePaymentFilters } from "@/lib/payments-report";

const PAGE_SIZE = 25;
const MAX_PAGE = 200;

/**
 * Platform owner only. Every Razorpay (and Cashfree) payment across all companies.
 * Query: range=today|7d|month|custom, from=&to= (YYYY-MM-DD, IST, for custom), status=all|captured|failed|pending|refunded,
 * planId=, q= (company name or code, payment or order id), page=.
 */
export async function GET(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const now = new Date();
  const params = new URL(req.url).searchParams;
  const filters = parsePaymentFilters(params, now);
  if ("error" in filters) return NextResponse.json({ error: filters.error }, { status: 400 });

  const pageRaw = Number(params.get("page") ?? 0);
  const page = Number.isInteger(pageRaw) && pageRaw >= 0 ? Math.min(pageRaw, MAX_PAGE) : 0;

  const [summary, trend, plans, list] = await Promise.all([
    paymentSummary(now),
    revenueTrend(now),
    listPlansForFilter(),
    listPayments(filters, page, PAGE_SIZE),
  ]);

  return NextResponse.json({
    summary,
    trend,
    plans,
    transactions: list.transactions,
    total: list.total,
    hasMore: list.hasMore,
    page,
    pageSize: PAGE_SIZE,
    generatedAt: now.toISOString(),
  });
}
