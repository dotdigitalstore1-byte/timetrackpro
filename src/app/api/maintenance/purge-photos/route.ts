import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { purgeExpiredPhotos } from "@/lib/photos";

// Scheduled job (e.g. a daily cron in Coolify): POST /api/maintenance/purge-photos
// with header "Authorization: Bearer $CRON_SECRET". Photos are also purged when an admin opens the photo audit.
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
  return NextResponse.json({ ok: true, attendanceRowsCleared: photosRemoved });
}

export const GET = run;
export const POST = run;
