import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { purgeExpiredPhotos, purgeOldAttendance } from "@/lib/photos";

// Scheduled job (e.g. a daily cron in Coolify): POST /api/maintenance/purge-photos
// with header "Authorization: Bearer $CRON_SECRET". It runs both retention rules:
//   - punch photos older than 45 days are deleted (attendance rows are kept)
//   - attendance rows older than 90 days are deleted (unless a company still has an unfinalized salary cycle)
// Photos are also purged when an admin opens the photo audit.
function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function run(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET is not configured on the server." }, { status: 503 });
  }
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const photosRemoved = await purgeExpiredPhotos();
  const recordsRemoved = await purgeOldAttendance();
  return NextResponse.json({ ok: true, attendanceRowsCleared: photosRemoved, attendanceRowsDeleted: recordsRemoved });
}

export const GET = run;
export const POST = run;
