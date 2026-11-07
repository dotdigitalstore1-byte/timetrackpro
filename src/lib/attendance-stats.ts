/**
 * The single definition of the attendance counts shown on the Attendance page AND the Home page,
 * so both always agree. Each record is one day of attendance in the active salary cycle.
 */
export interface StatRecord {
  status: string;
  punchInTime: string | Date | null;
}

export interface AttendanceCounts {
  present: number; // full days, on time
  late: number;
  half: number; // half days (includes a day with a missing punch-out once the day has ended)
  absent: number; // no punch-in on record
}

export function attendanceCounts(records: StatRecord[]): AttendanceCounts {
  return {
    present: records.filter((r) => r.status === "present").length,
    late: records.filter((r) => r.status === "late").length,
    half: records.filter((r) => r.status === "half_day").length,
    absent: records.filter((r) => r.status === "absent" || !r.punchInTime).length,
  };
}
