import { NextResponse } from "next/server";
import { CONTACT_ADMIN_MESSAGE } from "@/lib/billing-core";

/**
 * Returned to employees while their history is hidden (from the blur day after a subscription ends). The wording is
 * neutral and names who can restore access. It never mentions a payment.
 */
export function restrictedResponse() {
  return NextResponse.json({ error: CONTACT_ADMIN_MESSAGE, code: "RESTRICTED" }, { status: 403 });
}
