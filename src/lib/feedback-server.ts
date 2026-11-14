import { currentCycleKey, cyclePeriod, dateKey, localWorkDate } from "@/lib/payroll";
import { feedbackSlot } from "@/lib/feedback";

/**
 * The payroll cycle and the third of it that `now` falls in, for one company. Shared by the check-in route and the
 * notification feed, so both always agree on which check-in is current.
 */
export function currentFeedbackSlot(
  settings: { timezone: string; salaryCycleStartDay: number } | null,
  now: Date
): { cycleKey: string; slot: number; todayKey: string } {
  const tz = settings?.timezone || "UTC";
  const startDay = settings?.salaryCycleStartDay ?? 1;
  const today = localWorkDate(now, tz);
  const cycle = currentCycleKey(today, startDay);
  const period = cyclePeriod(cycle.year, cycle.month, startDay);
  return {
    cycleKey: `${cycle.year}-${String(cycle.month).padStart(2, "0")}`,
    slot: feedbackSlot(dateKey(period.start), dateKey(period.end), dateKey(today)),
    todayKey: dateKey(today),
  };
}
