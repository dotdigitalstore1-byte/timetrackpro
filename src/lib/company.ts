import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "@/db";
import { companyHolidays } from "@/db/schema";
import type { CompanySettings } from "@/db/schema";
import { dateKey, parseWeeklyOff } from "@/lib/payroll";

export function policyFrom(settings: CompanySettings) {
  return {
    shiftStart: settings.shiftStart,
    graceMinutes: settings.graceMinutes,
    lateThresholdMinutes: settings.lateThresholdMinutes,
    timezone: settings.timezone || "UTC",
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
