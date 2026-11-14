import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { adminFeedbackResponses } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { currentFeedbackSlot } from "@/lib/feedback-server";
import {
  AWARENESS_TEXT,
  AWARENESS_TITLE,
  QUESTIONNAIRE_VERSION,
  QUESTIONS,
  SLOT_LABELS,
  leniencyIndex,
  validateAnswers,
} from "@/lib/feedback";

/** Whether the company admin has a prompt due now, and the questionnaire to show. */
export async function GET() {
  const ctx = await getAuth();
  if (!ctx || !ctx.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ due: false });

  const { cycleKey, slot, todayKey } = currentFeedbackSlot(ctx.settings, new Date());
  const [existing] = await db
    .select({ id: adminFeedbackResponses.id })
    .from(adminFeedbackResponses)
    .where(and(eq(adminFeedbackResponses.companyId, ctx.company.id), eq(adminFeedbackResponses.cycleKey, cycleKey), eq(adminFeedbackResponses.slot, slot)))
    .limit(1);

  return NextResponse.json({
    due: !existing,
    cycleKey,
    slot,
    slotLabel: SLOT_LABELS[slot],
    todayKey,
    questionnaire: {
      version: QUESTIONNAIRE_VERSION,
      awarenessTitle: AWARENESS_TITLE,
      awarenessText: AWARENESS_TEXT,
      questions: QUESTIONS.map((q) => ({ id: q.id, text: q.text, options: q.options.map((o) => ({ key: o.key, label: o.label })) })),
    },
  });
}

/**
 * Submit the answers for the current slot. The slot is decided here, never by the browser.
 * The answers are stored without any user id, so they stay anonymous.
 */
export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx || !ctx.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Only the company admin answers this." }, { status: 403 });

  let body: { answers?: unknown; scrolledToEnd?: unknown; confirmed?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (body.scrolledToEnd !== true) {
    return NextResponse.json({ error: "Please read the whole awareness message before answering." }, { status: 400 });
  }
  if (body.confirmed !== true) {
    return NextResponse.json({ error: "Please confirm that your answers reflect your current policies." }, { status: 400 });
  }
  const checked = validateAnswers(body.answers);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const { cycleKey, slot } = currentFeedbackSlot(ctx.settings, new Date());
  try {
    await db.insert(adminFeedbackResponses).values({
      companyId: ctx.company.id,
      cycleKey,
      slot,
      questionnaireVersion: QUESTIONNAIRE_VERSION,
      answers: checked.answers,
      leniencyIndex: leniencyIndex(checked.answers),
      scrolledToEnd: true,
      respondedAt: new Date(),
    });
  } catch {
    return NextResponse.json({ error: "You have already answered this check for the current part of the cycle." }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
