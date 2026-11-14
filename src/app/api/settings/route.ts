import { NextResponse } from "next/server";
import { and, asc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, companies, companyBranding, companyHolidays, companySettings, salaryRecords } from "@/db/schema";
import { dateKey, isValidTimezone } from "@/lib/payroll";
import { loadCompanyProfile } from "@/lib/company-profile";
import { getAuth } from "@/lib/auth";

export async function GET() {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const companyId = ctx.company!.id;

  const settings = await db.select().from(companySettings).where(eq(companySettings.companyId, companyId)).limit(1);
  const holidays = await db.select().from(companyHolidays).where(eq(companyHolidays.companyId, companyId)).orderBy(asc(companyHolidays.holidayDate));
  const profile = await loadCompanyProfile(companyId);

  // Pay periods that already have a finalized or paid salary. Holidays inside them are locked (see POST).
  const locked = await db
    .selectDistinct({ start: salaryRecords.periodStart, end: salaryRecords.periodEnd })
    .from(salaryRecords)
    .where(
      and(
        eq(salaryRecords.companyId, companyId),
        inArray(salaryRecords.status, ["finalized", "paid"]),
        isNotNull(salaryRecords.periodStart),
        isNotNull(salaryRecords.periodEnd)
      )
    );
  const finalizedPeriods = locked.filter((p) => p.start && p.end).map((p) => ({ start: dateKey(p.start as Date), end: dateKey(p.end as Date) }));

  return NextResponse.json({
    settings: settings[0] ?? null,
    holidays,
    finalizedPeriods,
    company: profile,
  });
}

/** Is this date inside a pay period whose salary is already finalized or paid? */
async function isDateLocked(companyId: string, day: Date): Promise<boolean> {
  const rows = await db
    .select({ id: salaryRecords.id })
    .from(salaryRecords)
    .where(
      and(
        eq(salaryRecords.companyId, companyId),
        inArray(salaryRecords.status, ["finalized", "paid"]),
        lte(salaryRecords.periodStart, day),
        gte(salaryRecords.periodEnd, day)
      )
    )
    .limit(1);
  return rows.length > 0;
}

const LOCKED_MESSAGE = "That day is in a salary cycle that is already finalized, so its holidays can no longer change.";

// ---- Company profile (name, address, tax ID, logo). Shown on salary slips.

/** Logos are small: the admin's upload is resized in the browser to about 200 px wide before it is sent. */
const MAX_LOGO_CHARS = 200_000;
const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

function clean(v: unknown, max: number): string {
  return String(v ?? "").trim().slice(0, max);
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
    const clampInt = (v: unknown, lo: number, hi: number, fallback: number) =>
      Math.min(hi, Math.max(lo, Math.round(numField(v, fallback))));
    const clampNum = (v: unknown, lo: number, hi: number, fallback: number) =>
      Math.min(hi, Math.max(lo, numField(v, fallback)));
    const dedType = (v: unknown) => (v === "fixed" ? "fixed" : "percentage");
    if (typeof s.shiftStart === "string" && /^\d{2}:\d{2}$/.test(s.shiftStart)) update.shiftStart = s.shiftStart;
    if (typeof s.shiftEnd === "string" && /^\d{2}:\d{2}$/.test(s.shiftEnd)) update.shiftEnd = s.shiftEnd;
    if (s.graceMinutes !== undefined) update.graceMinutes = clampInt(s.graceMinutes, 0, 120, 5);
    if (s.lateThresholdMinutes !== undefined) update.lateThresholdMinutes = clampInt(s.lateThresholdMinutes, 0, 720, 30);
    if (s.halfDayThresholdMinutes !== undefined) update.halfDayThresholdMinutes = numField(s.halfDayThresholdMinutes, 120);
    if (s.lateDeductionType !== undefined) update.lateDeductionType = s.lateDeductionType === "fixed" ? "fixed" : "percentage";
    if (s.lateDeductionValue !== undefined) update.lateDeductionValue = String(Math.max(0, numField(s.lateDeductionValue, 5)));
    if (s.halfDayDeductionType !== undefined) update.halfDayDeductionType = s.halfDayDeductionType === "fixed" ? "fixed" : "percentage";
    if (s.halfDayDeductionValue !== undefined) update.halfDayDeductionValue = String(Math.max(0, numField(s.halfDayDeductionValue, 50)));
    if (s.leaveDeductionType !== undefined) update.leaveDeductionType = s.leaveDeductionType === "fixed" ? "fixed" : "percentage";
    if (s.leaveDeductionValue !== undefined) update.leaveDeductionValue = String(Math.max(0, numField(s.leaveDeductionValue, 100)));
    // Delay in days for each unapproved day (the salary hold rule).
    if (s.unapprovedHoldDays !== undefined) update.unapprovedHoldDays = clampInt(s.unapprovedHoldDays, 0, 30, 2);
    // Amounts are always in Indian Rupees; the currency is not configurable.
    update.currency = "₹";
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
    // ---- Rules: early leave
    if (s.earlyLeaveGraceMinutes !== undefined) update.earlyLeaveGraceMinutes = clampInt(s.earlyLeaveGraceMinutes, 0, 120, 5);
    if (s.earlyLeaveHalfDayMinutes !== undefined) update.earlyLeaveHalfDayMinutes = clampInt(s.earlyLeaveHalfDayMinutes, 0, 720, 0);
    if (s.earlyLeaveDeductionType !== undefined) update.earlyLeaveDeductionType = dedType(s.earlyLeaveDeductionType);
    if (s.earlyLeaveDeductionValue !== undefined) update.earlyLeaveDeductionValue = String(Math.max(0, numField(s.earlyLeaveDeductionValue, 0)));
    // ---- Rules: late marks
    if (s.lateMarksLimit !== undefined) update.lateMarksLimit = clampInt(s.lateMarksLimit, 0, 31, 0);
    if (s.lateMarksPenaltyDays !== undefined) update.lateMarksPenaltyDays = String(clampNum(s.lateMarksPenaltyDays, 0, 5, 0.5));
    // ---- Rules: overtime
    if (typeof s.overtimeEnabled === "boolean") update.overtimeEnabled = s.overtimeEnabled;
    if (s.overtimeMinMinutes !== undefined) update.overtimeMinMinutes = clampInt(s.overtimeMinMinutes, 0, 240, 30);
    if (s.overtimeRate !== undefined) update.overtimeRate = String(clampNum(s.overtimeRate, 1, 5, 1.5));
    if (s.overtimeMaxMinutesPerDay !== undefined) update.overtimeMaxMinutesPerDay = clampInt(s.overtimeMaxMinutesPerDay, 30, 720, 240);
    // ---- Salary cycle
    if (s.salaryCycleStartDay !== undefined) update.salaryCycleStartDay = clampInt(s.salaryCycleStartDay, 1, 28, 1);
    if (s.salaryDisbursementDay !== undefined) update.salaryDisbursementDay = clampInt(s.salaryDisbursementDay, 1, 28, 5);
    if (typeof s.salaryHoldEnabled === "boolean") update.salaryHoldEnabled = s.salaryHoldEnabled;
    // ---- Sunday / holiday pay cut
    // ---- Late-percentage rule (auto-absent) and mid-cycle slips
    if (typeof s.absentAfterPercentEnabled === "boolean") update.absentAfterPercentEnabled = s.absentAfterPercentEnabled;
    if (s.absentAfterPercent !== undefined) update.absentAfterPercent = clampInt(s.absentAfterPercent, 10, 100, 50);
    if (typeof s.midCycleSlipEnabled === "boolean") update.midCycleSlipEnabled = s.midCycleSlipEnabled;
    if (typeof s.holidayDeductionEnabled === "boolean") update.holidayDeductionEnabled = s.holidayDeductionEnabled;
    if (s.holidayDeductionTriggerCount !== undefined) update.holidayDeductionTriggerCount = clampInt(s.holidayDeductionTriggerCount, 1, 2, 2);
    // ---- Weekly-off work & comp-off
    if (s.leaveAccrualMode !== undefined) update.leaveAccrualMode = s.leaveAccrualMode === "lapse" ? "lapse" : "carry";
    if (typeof s.extraPayEnabled === "boolean") update.extraPayEnabled = s.extraPayEnabled;
    // ---- Notice period policy
    if (typeof s.noticeEnabled === "boolean") update.noticeEnabled = s.noticeEnabled;
    if (s.noticeDefaultDays !== undefined) update.noticeDefaultDays = clampInt(s.noticeDefaultDays, 1, 365, 30);
    if (s.noticeMaxDays !== undefined) update.noticeMaxDays = clampInt(s.noticeMaxDays, 1, 365, 90);
    if (typeof s.noticeAllowEarlyRelease === "boolean") update.noticeAllowEarlyRelease = s.noticeAllowEarlyRelease;
    if (s.extraPayRate !== undefined) update.extraPayRate = String(clampNum(s.extraPayRate, 0, 5, 1));

    const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (typeof update.shiftStart === "string" && !hhmm.test(update.shiftStart)) return NextResponse.json({ error: "Shift start must be HH:MM (24h)." }, { status: 400 });
    if (typeof update.shiftEnd === "string" && !hhmm.test(update.shiftEnd)) return NextResponse.json({ error: "Shift end must be HH:MM (24h)." }, { status: 400 });

    const existing = await db.select().from(companySettings).where(eq(companySettings.companyId, companyId)).limit(1);

    const merged = { ...(existing[0] ?? {}), ...update } as Record<string, unknown>;
    const mNum = (k: string) => Number(merged[k] ?? 0);
    if (mNum("lateThresholdMinutes") < mNum("graceMinutes")) {
      return NextResponse.json({ error: "The half-day cut-off must be later than the cool-off (grace) time." }, { status: 400 });
    }
    for (const [typeKey, valueKey, label] of [
      ["lateDeductionType", "lateDeductionValue", "Late deduction"],
      ["halfDayDeductionType", "halfDayDeductionValue", "Half-day deduction"],
      ["leaveDeductionType", "leaveDeductionValue", "Leave deduction"],
      ["earlyLeaveDeductionType", "earlyLeaveDeductionValue", "Early-leave deduction"],
    ] as const) {
      if (merged[typeKey] === "percentage" && mNum(valueKey) > 100) {
        return NextResponse.json({ error: `${label} cannot be more than 100%.` }, { status: 400 });
      }
    }
    if (mNum("noticeDefaultDays") > mNum("noticeMaxDays")) {
      return NextResponse.json({ error: "The standard notice cannot be longer than the maximum notice." }, { status: 400 });
    }
    if (mNum("earlyLeaveHalfDayMinutes") > 0 && mNum("earlyLeaveHalfDayMinutes") < mNum("earlyLeaveGraceMinutes")) {
      return NextResponse.json({ error: "The early-leave half-day limit must be longer than the early-leave cool-off time." }, { status: 400 });
    }

    if (existing[0]) {
      await db.update(companySettings).set(update).where(eq(companySettings.companyId, companyId));
    } else {
      await db.insert(companySettings).values({ companyId, ...update });
    }
  }

  if (body.company && typeof body.company === "object") {
    const c = body.company as Record<string, unknown>;
    const name = clean(c.name, 200);
    if (!name) return NextResponse.json({ error: "The company name cannot be empty." }, { status: 400 });
    await db
      .update(companies)
      .set({
        name,
        legalName: clean(c.legalName, 200) || null,
        address: clean(c.address, 500) || null,
        phone: clean(c.phone, 50) || null,
        email: clean(c.email, 200) || null,
        website: clean(c.website, 200) || null,
        taxId: clean(c.taxId, 50) || null,
      })
      .where(eq(companies.id, companyId));

    if (c.logoDataUrl !== undefined) {
      if (c.logoDataUrl === null || c.logoDataUrl === "") {
        await db.delete(companyBranding).where(eq(companyBranding.companyId, companyId));
      } else {
        const logo = String(c.logoDataUrl);
        if (logo.length > MAX_LOGO_CHARS || !LOGO_RE.test(logo)) {
          return NextResponse.json({ error: "Upload a PNG, JPEG or WebP logo under about 150 KB." }, { status: 400 });
        }
        await db
          .insert(companyBranding)
          .values({ companyId, logoDataUrl: logo, updatedAt: new Date() })
          .onConflictDoUpdate({ target: companyBranding.companyId, set: { logoDataUrl: logo, updatedAt: new Date() } });
      }
    }
  }

  if (body.holiday) {
    const h = body.holiday;
    const date = String(h.date || "");
    const name = String(h.name || "").trim().slice(0, 200);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) {
      return NextResponse.json({ error: "Enter a holiday date and name." }, { status: 400 });
    }
    const day = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(day.getTime()) || dateKey(day) !== date) {
      return NextResponse.json({ error: "That is not a real calendar date." }, { status: 400 });
    }
    if (await isDateLocked(companyId, day)) return NextResponse.json({ error: LOCKED_MESSAGE }, { status: 409 });
    await db
      .insert(companyHolidays)
      .values({ companyId, holidayDate: new Date(`${date}T00:00:00Z`), name })
      .onConflictDoUpdate({ target: [companyHolidays.companyId, companyHolidays.holidayDate], set: { name } });
  }
  if (body.deleteHolidayId) {
    const found = await db
      .select({ day: companyHolidays.holidayDate })
      .from(companyHolidays)
      .where(and(eq(companyHolidays.id, body.deleteHolidayId), eq(companyHolidays.companyId, companyId)))
      .limit(1);
    if (found[0] && (await isDateLocked(companyId, found[0].day))) return NextResponse.json({ error: LOCKED_MESSAGE }, { status: 409 });
    await db.delete(companyHolidays).where(and(eq(companyHolidays.id, body.deleteHolidayId), eq(companyHolidays.companyId, companyId)));
  }

  await db.insert(auditLogs).values({
    companyId,
    actorId: ctx.user.id,
    action: "settings.update",
    entity: "settings",
    details: { body: { settings: body.settings ?? null, company: !!body.company, holiday: !!body.holiday, deleteHoliday: !!body.deleteHolidayId } },
  });

  return NextResponse.json({ ok: true });
}