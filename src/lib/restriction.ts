import { NextResponse } from "next/server";

/**
 * Returned to employees while their history is hidden (5 to 29 days after the company's plan ended). The wording is
 * deliberately neutral: it never mentions a plan or a payment.
 */
export function restrictedResponse() {
  return NextResponse.json({ error: "Contact Admin to see these details.", code: "RESTRICTED" }, { status: 403 });
}
