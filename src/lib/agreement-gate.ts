import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { agreementAcknowledgements, companyAgreements } from "@/db/schema";
import { dateKey, localWorkDate } from "@/lib/payroll";
import {
  agreementStatusFor,
  firstPunchBlocker,
  PUNCH_BLOCKED_DECLINED,
  PUNCH_BLOCKED_PENDING,
  type AckRecord,
  type AgreementStatus,
} from "@/lib/agreements";

export interface PublishedAgreementRow {
  id: string;
  title: string;
  body: string;
  version: number;
  publishedAt: Date | null;
  acks: AckRecord[];
}

/** Every published agreement of the company, with this user's answers. Used by the pop-up and the punch gate. */
export async function loadPublishedAgreements(companyId: string, userId: string): Promise<PublishedAgreementRow[]> {
  const agreements = await db
    .select()
    .from(companyAgreements)
    .where(and(eq(companyAgreements.companyId, companyId), eq(companyAgreements.status, "published")))
    .orderBy(companyAgreements.publishedAt);
  if (agreements.length === 0) return [];

  const acks = await db
    .select()
    .from(agreementAcknowledgements)
    .where(
      and(
        eq(agreementAcknowledgements.userId, userId),
        inArray(
          agreementAcknowledgements.agreementId,
          agreements.map((a) => a.id)
        )
      )
    );

  return agreements.map((a) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    version: a.version,
    publishedAt: a.publishedAt,
    acks: acks
      .filter((k) => k.agreementId === a.id)
      .map((k) => ({
        version: k.version,
        response: k.response === "declined" ? ("declined" as const) : ("accepted" as const),
        permanent: k.permanent,
        workDate: dateKey(k.workDate),
      })),
  }));
}

/** The company-local day "today" for a timezone. */
export function todayKeyOf(now: Date, tz: string): string {
  return dateKey(localWorkDate(now, tz));
}

export function statusOf(agreement: PublishedAgreementRow, todayKey: string): AgreementStatus {
  return agreementStatusFor(agreement.version, agreement.acks, todayKey);
}

/**
 * Why the employee may not punch in right now, or null when punching is allowed.
 * An unanswered agreement blocks punching; a declined one blocks it for the rest of the day.
 */
export async function punchBlockMessage(companyId: string, userId: string, tz: string, now: Date): Promise<string | null> {
  const list = await loadPublishedAgreements(companyId, userId);
  if (list.length === 0) return null;
  const blocker = firstPunchBlocker(
    list.map((a) => ({ title: a.title, version: a.version, acks: a.acks })),
    todayKeyOf(now, tz)
  );
  if (!blocker) return null;
  return blocker.status === "declined_today" ? PUNCH_BLOCKED_DECLINED : PUNCH_BLOCKED_PENDING;
}
