import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { leaveRequests, noticePeriods, salarySlipRequests, users } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { loadPublishedAgreements, statusOf, todayKeyOf } from "@/lib/agreement-gate";
import { showsPopup } from "@/lib/agreements";
import type { NotificationItem } from "@/lib/notifications";

const LIST_LIMIT = 40;
const LOOKBACK_DAYS = 90;

function shortDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * The bell's feed. Staff see agreements (employees also see what needs answering today). Employees also see the
 * outcome of their own notice, leave and salary-slip requests. Admins see what is waiting for them.
 * An item is unread when it is newer than the last time the centre was opened, or when it still needs an answer.
 */
export async function GET() {
  const ctx = await getAuth();
  if (!ctx || !ctx.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role === "super_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const companyId = ctx.company.id;
  const tz = ctx.settings?.timezone || "UTC";
  const now = new Date();
  const todayKey = todayKeyOf(now, tz);
  const seenAt = ctx.user.notificationsSeenAt ?? new Date(0);
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86400000);
  const items: NotificationItem[] = [];
  const isEmployee = ctx.user.role === "employee" && !!ctx.employee;

  // ---- Agreements (everyone who is not an admin)
  if (ctx.user.role !== "company_admin") {
    const agreements = await loadPublishedAgreements(companyId, ctx.user.id);
    for (const a of agreements) {
      const status = statusOf(a, todayKey);
      const published = a.publishedAt ?? now;
      const needsAnswer = isEmployee && showsPopup(status) && status !== "accepted_today";
      let body = "For information.";
      if (isEmployee) {
        body =
          status === "pending"
            ? "Accept to punch in."
            : status === "declined_today"
              ? "You declined this today. Punching in is blocked until tomorrow."
              : status === "accepted_today"
                ? "Accepted for today. You will be asked again the next time you open the app."
                : "Accepted. It will not be shown again unless the agreement is updated.";
      }
      items.push({
        id: `agreement:${a.id}:${a.version}`,
        kind: "agreement",
        title: a.version > 1 ? `Updated agreement: ${a.title}` : `Company agreement: ${a.title}`,
        body,
        at: published.toISOString(),
        unread: needsAnswer || status === "declined_today" || published > seenAt,
        tone: status === "pending" ? "amber" : status === "declined_today" ? "red" : "indigo",
        agreementId: a.id,
      });
    }
  }

  // ---- Employee: decisions on their own requests
  if (isEmployee && ctx.employee) {
    const employeeId = ctx.employee.id;
    const [notices, leaves, slips] = await Promise.all([
      db
        .select()
        .from(noticePeriods)
        .where(and(eq(noticePeriods.employeeId, employeeId), eq(noticePeriods.companyId, companyId)))
        .orderBy(desc(noticePeriods.updatedAt))
        .limit(10),
      db
        .select()
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.employeeId, employeeId),
            inArray(leaveRequests.status, ["approved", "rejected"]),
          )
        )
        .orderBy(desc(leaveRequests.updatedAt))
        .limit(10),
      db
        .select()
        .from(salarySlipRequests)
        .where(and(eq(salarySlipRequests.employeeId, employeeId), isNotNull(salarySlipRequests.decidedAt)))
        .orderBy(desc(salarySlipRequests.decidedAt))
        .limit(10),
    ]);

    for (const n of notices) {
      if (n.updatedAt < since) continue;
      const label =
        n.status === "requested"
          ? { title: "Notice request sent", body: "Waiting for your admin to approve it.", tone: "amber" as const }
          : n.status === "active"
            ? { title: "Notice period in progress", body: `${n.noticeDays ?? "—"} days. Last working day: ${shortDate(n.lastWorkingDay)}.`, tone: "indigo" as const }
            : n.status === "rejected"
              ? { title: "Notice request declined", body: n.decisionNote || "Your admin declined the request.", tone: "red" as const }
              : n.status === "cancelled"
                ? { title: "Notice period cancelled", body: "Your notice period was cancelled by your admin.", tone: "slate" as const }
                : { title: "Notice period completed", body: `Ended on ${shortDate(n.lastWorkingDay)}.`, tone: "green" as const };
      items.push({
        id: `notice:${n.id}:${n.status}`,
        kind: "notice",
        title: label.title,
        body: label.body,
        at: n.updatedAt.toISOString(),
        unread: n.updatedAt > seenAt,
        tone: label.tone,
        href: "/notice",
      });
    }

    for (const l of leaves) {
      if (l.updatedAt < since) continue;
      const approved = l.status === "approved";
      items.push({
        id: `leave:${l.id}:${l.status}`,
        kind: "leave",
        title: approved ? "Leave approved" : "Leave rejected",
        body: `${shortDate(l.startDate)}${l.endDate.getTime() !== l.startDate.getTime() ? ` – ${shortDate(l.endDate)}` : ""}`,
        at: l.updatedAt.toISOString(),
        unread: l.updatedAt > seenAt,
        tone: approved ? "green" : "red",
        href: "/leaves",
      });
    }

    for (const s of slips) {
      if (!s.decidedAt || s.decidedAt < since) continue;
      const approved = s.status === "approved";
      items.push({
        id: `slip:${s.id}:${s.status}`,
        kind: "slip",
        title: approved ? "Salary slip ready" : "Salary slip request declined",
        body: `Salary cycle ending ${shortDate(new Date(Date.UTC(s.year, s.month - 1, 1)))}`,
        at: s.decidedAt.toISOString(),
        unread: s.decidedAt > seenAt,
        tone: approved ? "green" : "red",
        href: "/salary",
      });
    }
  }

  // ---- Admin: work waiting for a decision
  if (ctx.user.role === "company_admin") {
    const [pendingLeaves, pendingSlips, pendingNotices] = await Promise.all([
      db
        .select({ id: leaveRequests.id })
        .from(leaveRequests)
        .where(and(eq(leaveRequests.companyId, companyId), eq(leaveRequests.status, "pending"))),
      db
        .select({ id: salarySlipRequests.id })
        .from(salarySlipRequests)
        .where(and(eq(salarySlipRequests.companyId, companyId), eq(salarySlipRequests.status, "pending"))),
      db
        .select({ id: noticePeriods.id })
        .from(noticePeriods)
        .where(and(eq(noticePeriods.companyId, companyId), eq(noticePeriods.status, "requested"))),
    ]);
    const waiting = [
      { n: pendingLeaves.length, id: "leaves", title: "leave request", href: "/leaves", tone: "amber" as const },
      { n: pendingNotices.length, id: "notices", title: "notice period request", href: "/notice", tone: "red" as const },
      { n: pendingSlips.length, id: "slips", title: "salary slip request", href: "/salary", tone: "indigo" as const },
    ];
    for (const w of waiting) {
      if (w.n === 0) continue;
      items.push({
        id: `action:${w.id}`,
        kind: "action",
        title: `${w.n} ${w.title}${w.n === 1 ? "" : "s"} to review`,
        body: "Open it to approve or reject.",
        at: now.toISOString(),
        unread: true,
        tone: w.tone,
        href: w.href,
      });
    }
  }

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const list = items.slice(0, LIST_LIMIT);
  return NextResponse.json({
    items: list,
    unreadCount: items.filter((i) => i.unread).length,
    seenAt: ctx.user.notificationsSeenAt?.toISOString() ?? null,
  });
}

/** Marks everything as read: called when the notification centre is opened. */
export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx || !ctx.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { action?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if (body.action !== "mark_seen") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const now = new Date();
  await db.update(users).set({ notificationsSeenAt: now }).where(eq(users.id, ctx.user.id));
  return NextResponse.json({ ok: true, seenAt: now.toISOString() });
}
