import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { paymentDetail } from "@/lib/payments-admin";
import { isUuid } from "@/lib/payments-report";

/** Platform owner only. Full breakdown and gateway log of one payment. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Payment not found." }, { status: 404 });

  const detail = await paymentDetail(id);
  if (!detail) return NextResponse.json({ error: "Payment not found." }, { status: 404 });
  return NextResponse.json(detail);
}
