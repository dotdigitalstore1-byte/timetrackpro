// Pure helpers that turn one employee's salary cycle into a continuous list of calendar dates.
// No DB or framework imports, so the server route, the pages and the unit tests all share one definition.

import type { Period } from "@/lib/payroll";

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** "YYYY-MM-DD" of a UTC-midnight calendar date (same result as payroll's dateKey for these dates). */
function keyOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Weekday name of a plain "YYYY-MM-DD" calendar date (no timezone shift). */
export function weekdayOf(key: string): string {
  const d = new Date(`${key.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "" : WEEKDAY_NAMES[d.getUTCDay()];
}

/**
 * What a calendar date shows when it has no attendance row of its own:
 *  - "record"   : there is a stored punch / attendance row for the date (the caller shows that record)
 *  - "off"      : weekly off (e.g. Sunday) or a company holiday
 *  - "leave"    : approved leave on a working day
 *  - "absent"   : a past working day with no punch and no approved leave
 *  - "pending"  : today, a working day, not punched in yet (not absent until the day ends)
 *  - "upcoming" : a future working day with nothing planned
 */
export type CalendarKind = "record" | "off" | "leave" | "absent" | "pending" | "upcoming";

export interface CalendarDay {
  date: string; // YYYY-MM-DD
  weekday: string; // "Sunday", "Monday", ...
  kind: CalendarKind;
  label: string; // short badge text, e.g. "Sunday", "Leave", "Absent"
  note: string; // one line of detail under the date
}

export interface CalendarInput {
  period: Period; // inclusive, UTC midnights of company-local dates
  todayLocal: Date; // UTC midnight of today's company-local date
  weeklyOff: Set<number>;
  holidays: Set<string>; // YYYY-MM-DD
  recordDates: Set<string>; // dates that already have an attendance row
  approvedLeaves: { start: Date; end: Date }[];
  joinDate?: Date | null; // days before the join date are not listed
}

/**
 * Every calendar date of the period, LATEST FIRST, with no gaps. Dates with a stored record are marked "record"
 * so the caller can attach that record; every other date gets its status (Sunday, Holiday, Leave, Absent, ...).
 * The leave, absence and off-day rules match summarizeMonth (payroll), so the list and the counts always agree.
 */
export function calendarDays(i: CalendarInput): CalendarDay[] {
  const todayKey = keyOf(i.todayLocal);
  const out: CalendarDay[] = [];
  const DAY = 86400000;
  for (let t = i.period.end.getTime(); t >= i.period.start.getTime(); t -= DAY) {
    const day = new Date(t);
    if (i.joinDate && t < i.joinDate.getTime()) continue;
    const key = keyOf(day);
    const weekday = WEEKDAY_NAMES[day.getUTCDay()];
    const base = { date: key, weekday };

    if (i.recordDates.has(key)) {
      out.push({ ...base, kind: "record", label: "", note: "" });
      continue;
    }
    const isHoliday = i.holidays.has(key);
    if (isHoliday || i.weeklyOff.has(day.getUTCDay())) {
      out.push({ ...base, kind: "off", label: isHoliday ? "Holiday" : weekday, note: isHoliday ? "Company holiday" : "Weekly off" });
      continue;
    }
    const onLeave = i.approvedLeaves.some((l) => t >= l.start.getTime() && t <= l.end.getTime());
    if (onLeave) {
      out.push({ ...base, kind: "leave", label: "Leave", note: "Approved leave" });
      continue;
    }
    if (key === todayKey) {
      out.push({ ...base, kind: "pending", label: "Not punched in", note: "Today" });
    } else if (t > i.todayLocal.getTime()) {
      out.push({ ...base, kind: "upcoming", label: "Upcoming", note: "" });
    } else {
      out.push({ ...base, kind: "absent", label: "Absent", note: "No punch-in recorded" });
    }
  }
  return out;
}
