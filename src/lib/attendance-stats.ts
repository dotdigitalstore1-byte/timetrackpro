/**
 * The single definition of the "This salary cycle" tiles, used by the Home page AND the Attendance page.
 *
 * The counts come from payroll's own summary (summarizeMonth, the same function the salary page uses), so they
 * always agree with what gets paid:
 *  - Present : full working days on time (late days are NOT repeated here)
 *  - Late    : late working days
 *  - Half day: half days (incl. early-leave half days and a missing punch-out once the day has ended)
 *  - Leaves  : approved leave days on working days
 */
import type { MonthSummary } from "@/lib/payroll";

export interface CycleCounts {
  present: number;
  late: number;
  half: number;
  leave: number;
  absent: number; // not shown as a tile, but kept so the totals can be checked against the salary page
}

export const EMPTY_CYCLE_COUNTS: CycleCounts = { present: 0, late: 0, half: 0, leave: 0, absent: 0 };

/** Tile counts for one employee's cycle, from payroll's summary. */
export function cycleCounts(s: Pick<MonthSummary, "presentDays" | "lateDays" | "halfDays" | "leaveDays" | "absentDays">): CycleCounts {
  return {
    present: s.presentDays - s.lateDays,
    late: s.lateDays,
    half: s.halfDays,
    leave: s.leaveDays,
    absent: s.absentDays,
  };
}

/** Adds several employees' counts together (the "All employees" view). */
export function sumCycleCounts(list: CycleCounts[]): CycleCounts {
  return list.reduce(
    (t, c) => ({
      present: t.present + c.present,
      late: t.late + c.late,
      half: t.half + c.half,
      leave: t.leave + c.leave,
      absent: t.absent + c.absent,
    }),
    { ...EMPTY_CYCLE_COUNTS }
  );
}

// ---------------------------------------------------------------- labels & colours (client + server safe)

export type Tone = "green" | "red" | "amber" | "indigo" | "slate" | "sky";

/** Badge text for a stored / effective attendance status. */
export function statusLabel(status: string): string {
  return status === "present" ? "On time" : status === "late" ? "Late" : status === "half_day" ? "Half day" : status === "absent" ? "Absent" : status.replace("_", " ");
}

export function statusTone(status: string): Tone {
  return status === "present" ? "green" : status === "late" ? "amber" : status === "half_day" ? "red" : status === "absent" ? "red" : "slate";
}

/** Badge colour for a calendar date that has no record (Sunday, Holiday, Leave, Absent, ...). */
export function calendarTone(kind: string): Tone {
  return kind === "leave" ? "sky" : kind === "absent" ? "red" : kind === "pending" ? "amber" : "slate";
}
