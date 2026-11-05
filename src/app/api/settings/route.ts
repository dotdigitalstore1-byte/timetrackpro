import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, companyHolidays, companySettings } from "@/db/schema";
import { isValidTimezone } from "@/lib/payroll";
import { getAuth } from "@/lib/auth";

export async function GET() {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const companyId = ctx.company!.id;

  const settings = await db.select().from(companySettings).where(eq(companySettings.companyId, companyId)).limit(1);
  const holidays = await db.select().from(companyHolidays).where(eq(companyHolidays.companyId, companyId)).orderBy(asc(companyHolidays.holidayDate));

  return NextResponse.json({
    settings: settings[0] ?? null,
    holidays,
  });
}

export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const companyId = ctx.company!.id;

  const body = await req.json();

  if (body.settings) {
    const s = body.settings;
    const update: Record<string, unknown> = { updatedAt: new Date() };
    const numField = (v: unknown, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    if (typeof s.shiftStart === "string" && /^\d{2}:\d{2}$/.test(s.shiftStart)) update.shiftStart = s.shiftStart;
    if (typeof s.shiftEnd === "string" && /^\d{2}:\d{2}$/.test(s.shiftEnd)) update.shiftEnd = s.shiftEnd;
    if (s.graceMinutes !== undefined) update.graceMinutes = numField(s.graceMinutes, 5);
    if (s.lateThresholdMinutes !== undefined) update.lateThresholdMinutes = numField(s.lateThresholdMinutes, 30);
    if (s.halfDayThresholdMinutes !== undefined) update.halfDayThresholdMinutes = numField(s.halfDayThresholdMinutes, 120);
    if (s.lateDeductionType !== undefined) update.lateDeductionType = s.lateDeductionType === "fixed" ? "fixed" : "percentage";
    if (s.lateDeductionValue !== undefined) update.lateDeductionValue = String(numField(s.lateDeductionValue, 5));
    if (s.halfDayDeductionType !== undefined) update.halfDayDeductionType = s.halfDayDeductionType === "fixed" ? "fixed" : "percentage";
    if (s.halfDayDeductionValue !== undefined) update.halfDayDeductionValue = String(numField(s.halfDayDeductionValue, 50));
    if (s.leaveDeductionType !== undefined) update.leaveDeductionType = s.leaveDeductionType === "fixed" ? "fixed" : "percentage";
    if (s.leaveDeductionValue !== undefined) update.leaveDeductionValue = String(numField(s.leaveDeductionValue, 100));
    if (s.unapprovedHoldDays !== undefined) update.unapprovedHoldDays = Math.max(0, numField(s.unapprovedHoldDays, 2));
    if (s.workDaysPerMonth !== undefined) update.workDaysPerMonth = Math.max(1, numField(s.workDaysPerMonth, 26));
    if (s.currency !== undefined && String(s.currency).trim()) update.currency = String(s.currency).trim().slice(0, 10);
    if (s.approvalLevels !== undefined) update.approvalLevels = s.approvalLevels === 2 ? 2 : 1;
    if (s.timezone !== undefined) {
      const tz = String(s.timezone).trim();
      if (!isValidTimezone(tz)) return NextResponse.json({ error: "Unknown timezone. Use an IANA name such as Asia/Kolkata." }, { status: 400 });
      update.timezone = tz;
    }
    if (s.weeklyOff !== undefined) {
      const days = [...new Set(String(s.weeklyOff).split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))];
      if (days.length >= 7) return NextResponse.json({ error: "At least one day of the week must be a working day." }, { status: 400 });
      update.weeklyOff = days.sort().join(",");
    }
    if (s.annualLeaveDays !== undefined) update.annualLeaveDays = Math.min(365, Math.max(0, Math.round(numField(s.annualLeaveDays, 12))));
    const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (typeof update.shiftStart === "string" && !hhmm.test(update.shiftStart)) return NextResponse.json({ error: "Shift start must be HH:MM (24h)." }, { status: 400 });
    if (typeof update.shiftEnd === "string" && !hhmm.test(update.shiftEnd)) return NextResponse.json({ error: "Shift end must be HH:MM (24h)." }, { status: 400 });

    const existing = await db.select().from(companySettings).where(eq(companySettings.companyId, companyId)).limit(1);
    if (existing[0]) {
      await db.update(companySettings).set(update).where(eq(companySettings.companyId, companyId));
    } else {
      await db.insert(companySettings).values({ companyId, ...update });
    }
  }

  if (body.holiday) {
    const h = body.holiday;
    const date = String(h.date || "");
    const name = String(h.name || "").trim().slice(0, 200);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) {
      return NextResponse.json({ error: "Enter a holiday date and name." }, { status: 400 });
    }
    await db
      .insert(companyHolidays)
      .values({ companyId, holidayDate: new Date(`${date}T00:00:00Z`), name })
      .onConflictDoUpdate({ target: [companyHolidays.companyId, companyHolidays.holidayDate], set: { name } });
  }
  if (body.deleteHolidayId) {
    await db.delete(companyHolidays).where(and(eq(companyHolidays.id, body.deleteHolidayId), eq(companyHolidays.companyId, companyId)));
  }

  await db.insert(auditLogs).values({
    companyId,
    actorId: ctx.user.id,
    action: "settings.update",
    entity: "settings",
    details: { body: { settings: body.settings ?? null, holiday: !!body.holiday, deleteHoliday: !!body.deleteHolidayId } },
  });

  return NextResponse.json({ ok: true });
}