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
