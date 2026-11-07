import type { AttendanceRecord } from "@/db/schema";

/** Never send base64 photos in list/JSON responses — they are served by /api/attendance/[id]/photo. */
export function toClientRecord(r: AttendanceRecord) {
  return {
    id: r.id,
    employeeId: r.employeeId,
    workDate: r.workDate,
    punchInTime: r.punchInTime,
    punchOutTime: r.punchOutTime,
    hasPunchInPhoto: !!r.punchInPhoto,
    hasPunchOutPhoto: !!r.punchOutPhoto,
    hasPunchOut: !!r.punchOutTime,
    status: r.status,
    isManual: r.isManual,
    note: r.note,
    earlyLeaveMinutes: r.earlyLeaveMinutes,
    overtimeMinutes: r.overtimeMinutes,
  };
}

const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
export const MAX_PHOTO_CHARS = 700_000; // ~500 KB binary; client compresses to ~50 KB

export function validPhoto(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_PHOTO_CHARS && PHOTO_RE.test(value);
}

/** Shape for list queries that select the photo FLAGS instead of the photo data (never load base64 for a list). */
export interface AttendanceListRow {
  id: string;
  employeeId: string;
  workDate: Date;
  punchInTime: Date | null;
  punchOutTime: Date | null;
  status: string;
  isManual: boolean;
  note: string | null;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  hasPunchInPhoto: boolean;
  hasPunchOutPhoto: boolean;
}

export function toListRecord(r: AttendanceListRow) {
  return {
    id: r.id,
    employeeId: r.employeeId,
    workDate: r.workDate,
    punchInTime: r.punchInTime,
    punchOutTime: r.punchOutTime,
    hasPunchInPhoto: r.hasPunchInPhoto,
    hasPunchOutPhoto: r.hasPunchOutPhoto,
    hasPunchOut: !!r.punchOutTime,
    status: r.status,
    isManual: r.isManual,
    note: r.note,
    earlyLeaveMinutes: r.earlyLeaveMinutes,
    overtimeMinutes: r.overtimeMinutes,
  };
}
