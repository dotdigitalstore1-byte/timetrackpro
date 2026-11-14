import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { agreementAcknowledgements, auditLogs, companyAgreements, employees, users } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { loadPublishedAgreements, statusOf, todayKeyOf } from "@/lib/agreement-gate";
import { AGREEMENT_BODY_MAX, AGREEMENT_TITLE_MAX, blocksPunchIn, showsPopup } from "@/lib/agreements";
import { dateKey } from "@/lib/payroll";

/**
 * Admin: every agreement with how many active employees have accepted it (current version).
 * Staff (employee, manager): the published agreements, each with this user's status for today.
 */
export async function GET() {
  const ctx = await getAuth();
  if (!ctx || !ctx.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role === "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const companyId = ctx.company.id;
  const tz = ctx.settings?.timezone || "UTC";
  const now = new Date();
  const todayKey = todayKeyOf(now, tz);

  if (ctx.user.role === "company_admin") {
    const rows = await db
      .select()
      .from(companyAgreements)
      .where(eq(companyAgreements.companyId, companyId))
      .orderBy(desc(companyAgreements.updatedAt));

    // Active employee accounts: the people an agreement is pushed to.
    const staff = await db
      .select({ userId: employees.userId })
      .from(employees)
      .innerJoin(users, eq(employees.userId, users.id))
      .where(and(eq(employees.companyId, companyId), eq(employees.isActive, true), eq(users.role, "employee")));
    const memberIds = new Set(staff.map((s) => s.userId));

    // Every answer for the published agreements (permanent accepts never expire, so no date filter here).
    const published = rows.filter((r) => r.status === "published");
    const answers = published.length
      ? await db
          .select()
          .from(agreementAcknowledgements)
          .where(
            and(
              eq(agreementAcknowledgements.companyId, companyId),
              inArray(
                agreementAcknowledgements.agreementId,
                published.map((p) => p.id)
              )
            )
          )
      : [];

    return NextResponse.json({
      todayKey,
      staffCount: memberIds.size,
      agreements: rows.map((a) => {
        const current = answers.filter(
          (k) => k.agreementId === a.id && k.version === a.version && memberIds.has(k.userId)
        );
        const acceptedUsers = new Set(
          current
            .filter((k) => k.response === "accepted" && (k.permanent || dateKey(k.workDate) === todayKey))
            .map((k) => k.userId)
        );
        const declinedToday = new Set(
          current.filter((k) => k.response === "declined" && dateKey(k.workDate) === todayKey).map((k) => k.userId)
        );
        return {
          id: a.id,
          title: a.title,
          body: a.body,
          status: a.status,
          version: a.version,
          publishedAt: a.publishedAt,
          updatedAt: a.updatedAt,
          stats: a.status === "published" ? { accepted: acceptedUsers.size, declinedToday: declinedToday.size } : null,
        };
      }),
    });
  }

  // Employee or manager: published agreements with this user's own status.
  const list = await loadPublishedAgreements(companyId, ctx.user.id);
  const isEmployee = ctx.user.role === "employee";
  return NextResponse.json({
    todayKey,
    agreements: list.map((a) => {
      const status = statusOf(a, todayKey);
      return {
        id: a.id,
        title: a.title,
        body: a.body,
        version: a.version,
        publishedAt: a.publishedAt,
        status,
        // The pop-up and the punch block only apply to employees (managers and admins do not punch).
        popup: isEmployee && showsPopup(status),
        blocksPunch: isEmployee && blocksPunchIn(status),
      };
    }),
    punchBlocked: isEmployee && list.some((a) => blocksPunchIn(statusOf(a, todayKey))),
  });
}

/** Admin only. Actions: create, update, publish, withdraw, delete. */
export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx || !ctx.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Only the company admin can manage agreements." }, { status: 403 });
  const companyId = ctx.company.id;
  const now = new Date();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const action = String(body.action || "");

  const parseText = (): { title: string; body: string } | { error: string } => {
    const title = String(body.title ?? "").trim();
    const text = String(body.body ?? "").replace(/\r\n/g, "\n").trim();
    if (!title) return { error: "Give the agreement a title." };
    if (title.length > AGREEMENT_TITLE_MAX) return { error: `The title can be at most ${AGREEMENT_TITLE_MAX} characters.` };
    if (!text) return { error: "Write the agreement text before saving." };
    if (text.length > AGREEMENT_BODY_MAX) return { error: `The agreement text can be at most ${AGREEMENT_BODY_MAX} characters.` };
    return { title, body: text };
  };

  if (action === "create") {
    const parsed = parseText();
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const [row] = await db
      .insert(companyAgreements)
      .values({ companyId, title: parsed.title, body: parsed.body, status: "draft", version: 1, createdBy: ctx.user.id, createdAt: now, updatedAt: now })
      .returning({ id: companyAgreements.id });
    await audit(companyId, ctx.user.id, "agreement.create", row.id, { title: parsed.title });
    return NextResponse.json({ ok: true, id: row.id });
  }

  const id = String(body.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Agreement not found." }, { status: 404 });
  const [current] = await db
    .select()
    .from(companyAgreements)
    .where(and(eq(companyAgreements.id, id), eq(companyAgreements.companyId, companyId)))
    .limit(1);
  if (!current) return NextResponse.json({ error: "Agreement not found." }, { status: 404 });

  if (action === "update") {
    const parsed = parseText();
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const changed = parsed.title !== current.title || parsed.body !== current.body;
    if (current.status === "published" && changed) {
      // Editing a live agreement pushes the new text straight away: a new version asks everyone again.
      await db
        .update(companyAgreements)
        .set({ title: parsed.title, body: parsed.body, version: current.version + 1, publishedAt: now, updatedAt: now })
        .where(eq(companyAgreements.id, id));
      await audit(companyId, ctx.user.id, "agreement.update_push", id, { version: current.version + 1 });
      return NextResponse.json({ ok: true, version: current.version + 1, pushed: true });
    }
    await db
      .update(companyAgreements)
      .set({ title: parsed.title, body: parsed.body, updatedAt: now })
      .where(eq(companyAgreements.id, id));
    return NextResponse.json({ ok: true, version: current.version, pushed: false });
  }

  if (action === "publish") {
    if (current.status === "published") return NextResponse.json({ ok: true, version: current.version });
    // Re-pushing an agreement that was live before (withdrawn) makes everyone answer it again.
    const nextVersion = current.publishedAt ? current.version + 1 : current.version;
    await db
      .update(companyAgreements)
      .set({ status: "published", version: nextVersion, publishedAt: now, updatedAt: now })
      .where(eq(companyAgreements.id, id));
    await audit(companyId, ctx.user.id, "agreement.publish", id, { version: nextVersion });
    return NextResponse.json({ ok: true, version: nextVersion });
  }

  if (action === "withdraw") {
    await db.update(companyAgreements).set({ status: "draft", updatedAt: now }).where(eq(companyAgreements.id, id));
    await audit(companyId, ctx.user.id, "agreement.withdraw", id, {});
    return NextResponse.json({ ok: true });
  }

  if (action === "delete") {
    if (current.status === "published") {
      return NextResponse.json({ error: "Withdraw the agreement before deleting it." }, { status: 400 });
    }
    await db.delete(companyAgreements).where(eq(companyAgreements.id, id));
    await audit(companyId, ctx.user.id, "agreement.delete", id, { title: current.title });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

async function audit(companyId: string, actorId: string, action: string, entityId: string, details: Record<string, unknown>) {
  await db.insert(auditLogs).values({ companyId, actorId, action, entity: "agreement", entityId, details });
}
