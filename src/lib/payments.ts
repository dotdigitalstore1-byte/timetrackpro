// Payment gateway integration (Razorpay and Cashfree). The server decides the price, creates the order, confirms
// payment with the gateway, and activates the plan exactly once, whether the browser or the webhook arrives first.
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { billingCycles, companies, payments, plans, users } from "@/db/schema";
import type { Plan } from "@/db/schema";
import { activatePlan, seatsUsed } from "@/lib/billing";
import { quoteCycle, toMinorUnits } from "@/lib/billing-core";
import { cashfreeWebhookSignatureValid, razorpayPaymentSignatureValid, razorpayWebhookSignatureValid } from "@/lib/payments-core";

export type Provider = "razorpay" | "cashfree";

export class PaymentError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** The gateway in use, or null when none is configured with keys (then checkout is hidden). */
export function activeProvider(env: Record<string, string | undefined> = process.env): Provider | null {
  const chosen = (env.PAYMENT_PROVIDER || "").toLowerCase();
  if (chosen === "razorpay" && env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) return "razorpay";
  if (chosen === "cashfree" && env.CASHFREE_APP_ID && env.CASHFREE_SECRET_KEY) return "cashfree";
  return null;
}

function cashfreeBase(): string {
  return process.env.CASHFREE_ENV === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
}

function appUrl(): string {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

async function gatewayJson(res: Response, action: string): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    console.error(`payment gateway ${action} failed`, res.status, body);
    throw new PaymentError("The payment provider could not complete this request. Please try again.", 502);
  }
  return body;
}

export interface CheckoutPayload {
  paymentId: string;
  provider: Provider;
  orderId: string;
  amountRupees: number;
  razorpay?: { keyId: string; amountMinor: number; currency: string; name: string; description: string; prefill: { name: string; email: string; contact?: string } };
  cashfree?: { mode: "sandbox" | "production"; paymentSessionId: string };
}

/** Starts a purchase: quotes the price on the server, records a pending payment, and creates the gateway order. */
export async function createCheckout(args: { companyId: string; userId: string; planId: string; months: number }): Promise<CheckoutPayload> {
  const provider = activeProvider();
  if (!provider) throw new PaymentError("Online payments are not available yet. Please contact support.", 503);

  const [company] = await db.select().from(companies).where(eq(companies.id, args.companyId)).limit(1);
  const [user] = await db.select().from(users).where(eq(users.id, args.userId)).limit(1);
  const [plan] = await db.select().from(plans).where(and(eq(plans.id, args.planId), eq(plans.isActive, true))).limit(1);
  const [cycle] = await db
    .select()
    .from(billingCycles)
    .where(and(eq(billingCycles.months, args.months), eq(billingCycles.isActive, true)))
    .limit(1);
  if (!company || !user || !plan || !cycle) throw new PaymentError("That plan is not available.", 404);

  const headcount = await seatsUsed(company.id);
  if (plan.employeeLimit < headcount) {
    throw new PaymentError(`Your company has ${headcount} active people. Choose a plan with at least ${headcount} seats.`);
  }

  const quote = quoteCycle(
    { price: Number(plan.price), compareAtPrice: null },
    cycle.months,
    Number(cycle.discountPercent)
  );
  const description = `${plan.name} · ${cycle.months} ${cycle.months === 1 ? "month" : "months"}`;

  const [row] = await db
    .insert(payments)
    .values({
      companyId: company.id,
      planId: plan.id,
      createdBy: user.id,
      provider,
      months: cycle.months,
      amount: String(quote.total),
      discountPercent: cycle.discountPercent,
      currency: "INR",
      status: "created",
    })
    .returning();

  if (provider === "razorpay") {
    const keyId = process.env.RAZORPAY_KEY_ID!;
    const keySecret = process.env.RAZORPAY_KEY_SECRET!;
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: toMinorUnits(quote.total),
        currency: "INR",
        receipt: row.id,
        notes: { paymentId: row.id, companyId: company.id, planId: plan.id },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const order = await gatewayJson(res, "create order");
    const orderId = String(order.id);
    await db.update(payments).set({ providerOrderId: orderId }).where(eq(payments.id, row.id));
    return {
      paymentId: row.id,
      provider,
      orderId,
      amountRupees: quote.total,
      razorpay: {
        keyId,
        amountMinor: toMinorUnits(quote.total),
        currency: "INR",
        name: company.name,
        description,
        prefill: { name: user.fullName, email: user.email, ...(user.phone ? { contact: user.phone } : {}) },
      },
    };
  }

  // Cashfree requires a mobile number on every order.
  const phone = (user.phone || company.phone || "").replace(/\D/g, "").slice(-10);
  if (phone.length !== 10) {
    throw new PaymentError("Add a 10-digit mobile number to your profile to pay by Cashfree.");
  }
  const res = await fetch(`${cashfreeBase()}/orders`, {
    method: "POST",
    headers: {
      "x-client-id": process.env.CASHFREE_APP_ID!,
      "x-client-secret": process.env.CASHFREE_SECRET_KEY!,
      "x-api-version": "2023-08-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      order_id: row.id,
      order_amount: quote.total,
      order_currency: "INR",
      order_note: description,
      customer_details: { customer_id: user.id, customer_name: user.fullName, customer_email: user.email, customer_phone: phone },
      order_meta: { return_url: `${appUrl()}/billing?cf_order_id={order_id}` },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const order = await gatewayJson(res, "create order");
  await db.update(payments).set({ providerOrderId: row.id }).where(eq(payments.id, row.id));
  return {
    paymentId: row.id,
    provider,
    orderId: row.id,
    amountRupees: quote.total,
    cashfree: {
      mode: process.env.CASHFREE_ENV === "production" ? "production" : "sandbox",
      paymentSessionId: String(order.payment_session_id),
    },
  };
}

/**
 * Activates the plan for a payment that the gateway confirms as paid. Idempotent: a payment can only be fulfilled once,
 * so a browser confirmation and a webhook can arrive in either order.
 */
async function fulfill(paymentRowId: string, providerPaymentId: string | null, paidRupees: number): Promise<"paid" | "already_paid"> {
  const [row] = await db.select().from(payments).where(eq(payments.id, paymentRowId)).limit(1);
  if (!row) throw new PaymentError("Payment not found.", 404);
  if (row.status === "paid") return "already_paid";
  if (Math.round(paidRupees * 100) !== Math.round(Number(row.amount) * 100)) {
    await db.update(payments).set({ status: "failed" }).where(eq(payments.id, row.id));
    throw new PaymentError("The amount paid does not match the plan price. The payment was not applied.", 400);
  }

  // Claim the payment so two deliveries cannot both activate it.
  const claimed = await db
    .update(payments)
    .set({ status: "processing" })
    .where(and(eq(payments.id, row.id), eq(payments.status, "created")))
    .returning();
  if (claimed.length === 0) return "already_paid";

  try {
    const [plan] = await db.select().from(plans).where(eq(plans.id, row.planId!)).limit(1);
    if (!plan) throw new Error("plan for payment no longer exists");
    await activatePlan({
      companyId: row.companyId,
      plan: plan as Plan,
      months: row.months,
      discountPercent: Number(row.discountPercent),
      actorId: row.createdBy,
      comped: false,
    });
    await db
      .update(payments)
      .set({ status: "paid", providerPaymentId, paidAt: new Date() })
      .where(eq(payments.id, row.id));
    return "paid";
  } catch (e) {
    await db.update(payments).set({ status: "created" }).where(eq(payments.id, row.id));
    throw e;
  }
}

/** Called by the browser after checkout returns. Re-checks the payment with the gateway; never trusts the browser's claim. */
export async function confirmCheckout(args: {
  companyId: string;
  provider: Provider;
  orderId: string;
  paymentId?: string;
  signature?: string;
}): Promise<"paid" | "pending" | "already_paid"> {
  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.companyId, args.companyId), eq(payments.provider, args.provider), eq(payments.providerOrderId, args.orderId)))
    .limit(1);
  if (!row) throw new PaymentError("Payment not found.", 404);
  if (row.status === "paid") return "already_paid";

  if (args.provider === "razorpay") {
    if (!args.paymentId || !args.signature) throw new PaymentError("Payment could not be verified.");
    if (!razorpayPaymentSignatureValid(args.orderId, args.paymentId, args.signature, process.env.RAZORPAY_KEY_SECRET ?? "")) {
      throw new PaymentError("Payment could not be verified.");
    }
    const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(args.paymentId)}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64")}` },
      signal: AbortSignal.timeout(15_000),
    });
    const payment = await gatewayJson(res, "fetch payment");
    if (payment.status !== "captured") return "pending";
    return (await fulfill(row.id, args.paymentId, Number(payment.amount) / 100)) === "paid" ? "paid" : "already_paid";
  }

  const res = await fetch(`${cashfreeBase()}/orders/${encodeURIComponent(args.orderId)}`, {
    headers: {
      "x-client-id": process.env.CASHFREE_APP_ID!,
      "x-client-secret": process.env.CASHFREE_SECRET_KEY!,
      "x-api-version": "2023-08-01",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const order = await gatewayJson(res, "fetch order");
  if (order.order_status !== "PAID") return "pending";
  return (await fulfill(row.id, null, Number(order.order_amount))) === "paid" ? "paid" : "already_paid";
}

/** Razorpay webhook. Returns false when the signature is wrong. Unknown or unrelated events are acknowledged and ignored. */
export async function handleRazorpayWebhook(rawBody: string, signature: string): Promise<boolean> {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !razorpayWebhookSignatureValid(rawBody, signature, secret)) return false;
  const event = JSON.parse(rawBody) as { event?: string; payload?: { payment?: { entity?: { id: string; order_id: string; amount: number; status: string } } } };
  if (event.event !== "payment.captured") return true;
  const entity = event.payload?.payment?.entity;
  if (!entity) return true;
  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.provider, "razorpay"), eq(payments.providerOrderId, entity.order_id)))
    .limit(1);
  if (row) await fulfill(row.id, entity.id, entity.amount / 100);
  return true;
}

/** Cashfree webhook. Returns false when the signature is wrong. */
export async function handleCashfreeWebhook(rawBody: string, timestamp: string, signature: string): Promise<boolean> {
  const secret = process.env.CASHFREE_SECRET_KEY;
  if (!secret || !cashfreeWebhookSignatureValid(rawBody, timestamp, signature, secret)) return false;
  const event = JSON.parse(rawBody) as {
    type?: string;
    data?: { order?: { order_id: string; order_amount: number }; payment?: { cf_payment_id?: number | string } };
  };
  if (event.type !== "PAYMENT_SUCCESS_WEBHOOK" || !event.data?.order) return true;
  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.provider, "cashfree"), eq(payments.providerOrderId, event.data.order.order_id)))
    .limit(1);
  if (row) await fulfill(row.id, String(event.data.payment?.cf_payment_id ?? ""), event.data.order.order_amount);
  return true;
}
