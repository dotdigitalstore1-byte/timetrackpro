import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { companyHolidays } from "@/db/schema";
import type { CompanySettings } from "@/db/schema";
import { dateKey, parseWeeklyOff, type SummaryRules } from "@/lib/payroll";

export function policyFrom(settings: CompanySettings) {
  return {
    shiftStart: settings.shiftStart,
    graceMinutes: settings.graceMinutes,
    lateThresholdMinutes: settings.lateThresholdMinutes,
    timezone: settings.timezone || "UTC",
  };
}

interface ShiftFields {
  shiftStart: string | null;
  shiftEnd: string | null;
}

/** The employee's own shift, falling back to the company default shift. */
export function shiftOf(settings: CompanySettings, employee?: ShiftFields | null): { start: string; end: string } {
  return {
    start: employee?.shiftStart || settings.shiftStart,
    end: employee?.shiftEnd || settings.shiftEnd,
  };
}

/** Late-arrival policy for one employee: company rules + that employee's shift start. */
export function policyFor(settings: CompanySettings, employee?: ShiftFields | null) {
  return { ...policyFrom(settings), shiftStart: shiftOf(settings, employee).start };
}

/** Company rules that affect how recorded days are counted in payroll. */
export function summaryRulesOf(settings: CompanySettings): SummaryRules {
  return {
    earlyLeaveGraceMinutes: settings.earlyLeaveGraceMinutes,
    earlyLeaveHalfDayMinutes: settings.earlyLeaveHalfDayMinutes,
    overtime: settings.overtimeEnabled
      ? { minMinutes: settings.overtimeMinMinutes, maxMinutesPerDay: settings.overtimeMaxMinutesPerDay }
      : null,
  };
}

export function weeklyOffOf(settings: CompanySettings): Set<number> {
  return parseWeeklyOff(settings.weeklyOff);
}

/** Set of YYYY-MM-DD holiday keys for [start, end). */
export async function holidayKeys(companyId: string, start: Date, end: Date): Promise<Set<string>> {
  const rows = await db
    .select()
    .from(companyHolidays)
    .where(
      and(
        eq(companyHolidays.companyId, companyId),
        gte(companyHolidays.holidayDate, start),
        lt(companyHolidays.holidayDate, end)
      )
    );
  return new Set(rows.map((r) => dateKey(r.holidayDate)));
}
