import { NextResponse } from "next/server";
import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, companies, companyBranding, companyHolidays, companySettings, salaryRecords } from "@/db/schema";
import { cyclePeriod, dateKey, isValidTimezone, localWorkDate } from "@/lib/payroll";
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
  const lockedCycles = await finalizedRanges(companyId);

  return NextResponse.json({
    settings: settings[0] ?? null,
    holidays,
    company: profile,
    // Salary cycles that are already finalized. Their holidays are frozen (see POST).
    lockedCycles,
    today: dateKey(localWorkDate(new Date(), settings[0]?.timezone || "UTC")),
  });
}

// ---- Paid holidays: a company holiday is a paid day off. It can be added for any date of a cycle that is not
// finalized yet (including days that have already passed), so a forgotten weekly off can be corrected.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The pay periods of finalized / paid salaries. Salaries finalized before cycles existed were calendar months. */
async function finalizedRanges(companyId: string): Promise<{ start: string; end: string }[]> {
  const rows = await db
    .select({ year: salaryRecords.year, month: salaryRecords.month, periodStart: salaryRecords.periodStart, periodEnd: salaryRecords.periodEnd })
    .from(salaryRecords)
    .where(and(eq(salaryRecords.companyId, companyId), inArray(salaryRecords.status, ["finalized", "paid"])));
  const seen = new Map<string, { start: string; end: string }>();
  for (const r of rows) {
    const p = r.periodStart && r.periodEnd ? { start: r.periodStart, end: r.periodEnd } : cyclePeriod(r.year, r.month, 1);
    const range = { start: dateKey(p.start), end: dateKey(p.end) };
    seen.set(`${range.start}|${range.end}`, range);
  }
  return [...seen.values()].sort((a, b) => a.start.localeCompare(b.start));
}

/** True when some employee's salary covering this date is already finalized. */
async function isDateLocked(companyId: string, key: string): Promise<boolean> {
  const day = new Date(`${key}T00:00:00Z`);
  const rows = await db
    .select({ id: salaryRecords.id })
    .from(salaryRecords)
    .where(
      and(
        eq(salaryRecords.companyId, companyId),
        inArray(salaryRecords.status, ["finalized", "paid"]),
        or(
          and(lte(salaryRecords.periodStart, day), gte(salaryRecords.periodEnd, day)),
          and(isNull(salaryRecords.periodStart), eq(salaryRecords.year, day.getUTCFullYear()), eq(salaryRecords.month, day.getUTCMonth() + 1))
        )
      )
    )
    .limit(1);
  return rows.length > 0;
}

function validDateKey(key: string): boolean {
  if (!DATE_RE.test(key)) return false;
  const d = new Date(`${key}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== key) return false;
  const year = d.getUTCFullYear();
  const nowYear = new Date().getUTCFullYear();
  return year >= nowYear - 2 && year <= nowYear + 2;
}

const LOCKED_MESSAGE = "That date belongs to a salary cycle that is already finalized, so its holidays can no longer be changed.";

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

  // One date: { holiday: { date, name } }. Several dates at once: { holidays: { dates: [...], name } }.
  const holidayInput: { dates: string[]; name: string } | null = body.holidays
    ? { dates: Array.isArray(body.holidays.dates) ? body.holidays.dates.map(String) : [], name: String(body.holidays.name || "").trim().slice(0, 200) }
    : body.holiday
      ? { dates: [String(body.holiday.date || "")], name: String(body.holiday.name || "").trim().slice(0, 200) }
      : null;
  let holidaysAdded = 0;
  if (holidayInput) {
    const dates = [...new Set(holidayInput.dates)].slice(0, 62);
    if (dates.length === 0 || !holidayInput.name || dates.some((d) => !validDateKey(d))) {
      return NextResponse.json({ error: "Enter a holiday date and name." }, { status: 400 });
    }
    for (const d of dates) {
      if (await isDateLocked(companyId, d)) return NextResponse.json({ error: LOCKED_MESSAGE }, { status: 409 });
    }
    for (const d of dates) {
      await db
        .insert(companyHolidays)
        .values({ companyId, holidayDate: new Date(`${d}T00:00:00Z`), name: holidayInput.name })
        .onConflictDoUpdate({ target: [companyHolidays.companyId, companyHolidays.holidayDate], set: { name: holidayInput.name } });
    }
    holidaysAdded = dates.length;
  }
  if (body.deleteHolidayId) {
    const target = await db
      .select()
      .from(companyHolidays)
      .where(and(eq(companyHolidays.id, body.deleteHolidayId), eq(companyHolidays.companyId, companyId)))
      .limit(1);
    if (target[0]) {
      if (await isDateLocked(companyId, dateKey(target[0].holidayDate))) {
        return NextResponse.json({ error: LOCKED_MESSAGE }, { status: 409 });
      }
      await db.delete(companyHolidays).where(and(eq(companyHolidays.id, target[0].id), eq(companyHolidays.companyId, companyId)));
    }
  }

  await db.insert(auditLogs).values({
    companyId,
    actorId: ctx.user.id,
    action: "settings.update",
    entity: "settings",
    details: { body: { settings: body.settings ?? null, company: !!body.company, holidaysAdded, holidayDates: holidayInput?.dates ?? [], deleteHoliday: !!body.deleteHolidayId } },
  });

  return NextResponse.json({ ok: true });
}