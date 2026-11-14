import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agreementAcknowledgements, auditLogs, companyAgreements } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { loadPublishedAgreements, statusOf, todayKeyOf } from "@/lib/agreement-gate";
import { localWorkDate } from "@/lib/payroll";

/**
 * An employee answers a published agreement.
 *  - accepted: counts for today. With dontShowAgain it is permanent for this version.
 *  - declined: punching in is blocked for the rest of today. The employee is asked again on the next day.
 */
export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx || !ctx.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "employee" || !ctx.employee) {
    return NextResponse.json({ error: "Only employees respond to company agreements." }, { status: 403 });
  }
  const companyId = ctx.company.id;
  const tz = ctx.settings?.timezone || "UTC";
  const now = new Date();

  let body: { agreementId?: unknown; response?: unknown; dontShowAgain?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const agreementId = String(body.agreementId || "");
  if (!/^[0-9a-f-]{36}$/i.test(agreementId)) return NextResponse.json({ error: "Agreement not found." }, { status: 404 });
  const response = body.response === "declined" ? "declined" : body.response === "accepted" ? "accepted" : null;
  if (!response) return NextResponse.json({ error: "Choose Accept or Decline." }, { status: 400 });
  const dontShowAgain = response === "accepted" && body.dontShowAgain === true;

  const [agreement] = await db
    .select()
    .from(companyAgreements)
    .where(and(eq(companyAgreements.id, agreementId), eq(companyAgreements.companyId, companyId), eq(companyAgreements.status, "published")))
    .limit(1);
  if (!agreement) return NextResponse.json({ error: "This agreement is no longer published." }, { status: 404 });

  // Look at this employee's current standing before recording anything.
  const mine = (await loadPublishedAgreements(companyId, ctx.user.id)).find((a) => a.id === agreement.id);
  const todayKey = todayKeyOf(now, tz);
  const status = mine ? statusOf(mine, todayKey) : "pending";

  if (status === "permanent") {
    return NextResponse.json({ ok: true, status: "permanent" });
  }
  if (response === "accepted" && status === "declined_today") {
    return NextResponse.json(
      { error: "You declined this agreement today, so it cannot be accepted until tomorrow." },
      { status: 400 }
    );
  }
  if (response === "declined" && status === "accepted_today") {
    return NextResponse.json({ error: "You already accepted this agreement today." }, { status: 400 });
  }

  const workDate = localWorkDate(now, tz);
  await db
    .insert(agreementAcknowledgements)
    .values({
      companyId,
      agreementId: agreement.id,
      userId: ctx.user.id,
      version: agreement.version,
      response,
      workDate,
      permanent: dontShowAgain,
      respondedAt: now,
    })
    .onConflictDoUpdate({
      target: [agreementAcknowledgements.agreementId, agreementAcknowledgements.userId, agreementAcknowledgements.version, agreementAcknowledgements.workDate],
      set: { response, permanent: dontShowAgain, respondedAt: now },
    });

  await db.insert(auditLogs).values({
    companyId,
    actorId: ctx.user.id,
    action: `agreement.${response}`,
    entity: "agreement",
    entityId: agreement.id,
    details: { version: agreement.version, dontShowAgain },
  });

  return NextResponse.json({
    ok: true,
    status: response === "declined" ? "declined_today" : dontShowAgain ? "permanent" : "accepted_today",
  });
}
