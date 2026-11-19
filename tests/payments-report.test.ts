import assert from "node:assert/strict";
import { test } from "node:test";
import {
  displayStatus,
  istDateKey,
  istDateTime,
  istDayStartOf,
  istMonthStartOf,
  maskVpa,
  methodLabel,
  parseIstDay,
  parsePaymentFilters,
  razorpayGatewayDetails,
  resolveRange,
  toCsv,
} from "../src/lib/payments-report.ts";

const iso = (s: string) => new Date(s);

test("IST days start at 18:30 UTC the previous day", () => {
  // 19 Nov 2026 at 01:00 IST is 18 Nov 19:30 UTC: it still belongs to 19 Nov in India.
  const now = iso("2026-11-18T19:30:00Z");
  assert.equal(istDateKey(now), "2026-11-19");
  assert.equal(istDayStartOf(now).toISOString(), "2026-11-18T18:30:00.000Z");
});

test("a payment just before IST midnight belongs to the previous IST day", () => {
  // 18:29 UTC is 23:59 IST.
  assert.equal(istDateKey(iso("2026-11-18T18:29:59Z")), "2026-11-18");
  assert.equal(istDateKey(iso("2026-11-18T18:30:00Z")), "2026-11-19");
});

test("month starts on the 1st in IST, not UTC", () => {
  // 31 Oct 2026 at 20:00 UTC is already 1 Nov in India.
  const now = iso("2026-10-31T20:00:00Z");
  assert.equal(istDateKey(now), "2026-11-01");
  assert.equal(istMonthStartOf(now).toISOString(), "2026-10-31T18:30:00.000Z");
  assert.equal(istMonthStartOf(now, -1).toISOString(), "2026-09-30T18:30:00.000Z");
});

test("parseIstDay accepts real dates and rejects everything else", () => {
  assert.ok(parseIstDay("2026-02-28"));
  assert.equal(parseIstDay("2026-02-30"), null, "no such day");
  assert.equal(parseIstDay("2026-13-01"), null, "no such month");
  assert.equal(parseIstDay("19/11/2026"), null, "wrong format");
  assert.equal(parseIstDay(""), null);
  assert.equal(parseIstDay(null), null);
});

test("'today' runs from IST midnight to the next IST midnight", () => {
  const now = iso("2026-11-19T06:00:00Z"); // 11:30 IST
  const b = resolveRange("today", now);
  assert.ok(!("error" in b));
  assert.equal(b.from!.toISOString(), "2026-11-18T18:30:00.000Z");
  assert.equal(b.to!.toISOString(), "2026-11-19T18:30:00.000Z");
});

test("'last 7 days' includes today and the six days before it", () => {
  const b = resolveRange("7d", iso("2026-11-19T06:00:00Z"));
  assert.ok(!("error" in b));
  assert.equal(istDateKey(b.from!), "2026-11-13");
  assert.equal(b.to, null);
});

test("custom range end date is inclusive of the whole day", () => {
  const b = resolveRange("custom", iso("2026-11-19T06:00:00Z"), "2026-11-01", "2026-11-05");
  assert.ok(!("error" in b));
  assert.equal(istDateKey(b.from!), "2026-11-01");
  assert.equal(istDateKey(new Date(b.to!.getTime() - 1)), "2026-11-05", "last instant is still the 5th");
});

test("custom range rejects missing, reversed and over-long ranges", () => {
  const now = iso("2026-11-19T06:00:00Z");
  assert.ok("error" in resolveRange("custom", now, "2026-11-01", null));
  assert.ok("error" in resolveRange("custom", now, "2026-11-10", "2026-11-01"));
  assert.ok("error" in resolveRange("custom", now, "2024-01-01", "2026-11-01"), "longer than the cap");
  assert.ok(!("error" in resolveRange("custom", now, "2026-11-01", "2026-11-01")), "a single day is valid");
});

test("filter parsing falls back to safe defaults for unknown values", () => {
  const now = iso("2026-11-19T06:00:00Z");
  const f = parsePaymentFilters(new URLSearchParams("range=bogus&status=exploded&planId=not-a-uuid&q=%20%20acme%20%20"), now);
  assert.ok(!("error" in f));
  assert.equal(f.range, "month");
  assert.equal(f.status, "all");
  assert.equal(f.planId, null);
  assert.equal(f.q, "acme");
});

test("filter parsing keeps a valid plan id and caps the search length", () => {
  const now = iso("2026-11-19T06:00:00Z");
  const plan = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const f = parsePaymentFilters(new URLSearchParams(`range=today&status=failed&planId=${plan}&q=${"x".repeat(200)}`), now);
  assert.ok(!("error" in f));
  assert.equal(f.planId, plan);
  assert.equal(f.status, "failed");
  assert.equal(f.q.length, 80);
});

test("stored statuses map onto the four report statuses", () => {
  assert.deepEqual(displayStatus("paid"), { key: "captured", label: "Captured" });
  assert.deepEqual(displayStatus("failed"), { key: "failed", label: "Failed" });
  assert.deepEqual(displayStatus("refunded"), { key: "refunded", label: "Refunded" });
  assert.deepEqual(displayStatus("partially_refunded"), { key: "refunded", label: "Partially refunded" });
  assert.deepEqual(displayStatus("created"), { key: "pending", label: "Pending" });
  assert.deepEqual(displayStatus("processing"), { key: "pending", label: "Pending" });
});

test("payment methods read naturally, including Cashfree's names", () => {
  assert.equal(methodLabel("upi"), "UPI");
  assert.equal(methodLabel("netbanking"), "Netbanking");
  assert.equal(methodLabel("net_banking"), "Netbanking");
  assert.equal(methodLabel("credit_card"), "Card");
  assert.equal(methodLabel("paylater"), "Pay later");
  assert.equal(methodLabel("some_new_method"), "Some new method");
  assert.equal(methodLabel(null), "—");
});

test("UPI IDs are masked so the full handle is never stored", () => {
  assert.equal(maskVpa("rahul.k@oksbi"), "r***@oksbi");
  assert.equal(maskVpa("nodomain"), "***");
});

test("Razorpay details keep useful fields, convert paise, mask UPI and drop personal data", () => {
  const details = razorpayGatewayDetails({
    id: "pay_ABC123",
    order_id: "order_XYZ789",
    method: "upi",
    status: "captured",
    amount: 49900,
    fee: 1180,
    tax: 180,
    vpa: "rahul.k@oksbi",
    email: "rahul@example.com", // not read, so it must not appear
    contact: "+919999999999", // not read
    created_at: 1763532000,
    card: null,
  } as never);
  assert.equal(details.paymentId, "pay_ABC123");
  assert.equal(details.orderId, "order_XYZ789");
  assert.equal(details.method, "upi");
  assert.equal(details.fee, 11.8);
  assert.equal(details.tax, 1.8);
  assert.equal(details.vpa, "r***@oksbi");
  assert.equal(details.gatewayCreatedAt, new Date(1763532000 * 1000).toISOString());
  assert.equal("email" in details, false);
  assert.equal("contact" in details, false);
  assert.equal("cardLast4" in details, false, "no card fields when the payment was not by card");
});

test("failed payments keep the gateway's error reason, and empty values are dropped", () => {
  const details = razorpayGatewayDetails({
    id: "pay_FAIL",
    method: "card",
    error_code: "BAD_REQUEST_ERROR",
    error_description: "Payment failed",
    error_reason: "payment_failed",
    error_source: "customer",
    error_step: "payment_authentication",
    bank: null,
    wallet: "",
    card: { network: "Visa", last4: "4242", type: "credit", issuer: null },
  } as never);
  assert.equal(details.errorCode, "BAD_REQUEST_ERROR");
  assert.equal(details.errorReason, "payment_failed");
  assert.equal(details.cardLast4, "4242");
  assert.equal("bank" in details, false);
  assert.equal("wallet" in details, false);
  assert.equal("cardIssuer" in details, false);
});

test("CSV escapes commas, quotes and newlines, and neutralises formula injection", () => {
  const csv = toCsv(
    [
      { key: "company", header: "Company" },
      { key: "amount", header: "Amount (₹)" },
      { key: "note", header: "Note" },
    ],
    [
      { company: 'Acme, "Ltd"', amount: 499, note: "=HYPERLINK(\"http://x\")" },
      { company: "Beta\nLine", amount: -10, note: "+SUM(A1)" },
      { company: null, amount: undefined, note: "@cmd" },
    ]
  );
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "Company,Amount (₹),Note");
  assert.equal(lines[1], '"Acme, ""Ltd""",499,"\'=HYPERLINK(""http://x"")"');
  assert.equal(lines[2], '"Beta\nLine",-10,\'+SUM(A1)');
  assert.equal(lines[3], ",,'@cmd");
});

test("export timestamps are shown in IST", () => {
  assert.equal(istDateTime(iso("2026-11-19T08:35:00Z")), "2026-11-19 14:05");
});
