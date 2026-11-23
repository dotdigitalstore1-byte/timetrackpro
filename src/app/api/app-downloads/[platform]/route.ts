import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appDownloads } from "@/db/schema";
import { getAuthAllowLocked } from "@/lib/auth";
import { isAppPlatform, safeDownloadName } from "@/lib/app-links-core";

/** Direct download of an uploaded app package. Only signed-in users can download it. */
export async function GET(_req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const ctx = await getAuthAllowLocked();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { platform } = await params;
  if (!isAppPlatform(platform)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [row] = await db.select().from(appDownloads).where(eq(appDownloads.platform, platform)).limit(1);
  if (!row) return NextResponse.json({ error: "No file has been uploaded for this platform." }, { status: 404 });

  return new NextResponse(new Uint8Array(row.data), {
    status: 200,
    headers: {
      "Content-Type": row.contentType,
      "Content-Length": String(row.sizeBytes),
      "Content-Disposition": `attachment; filename="${safeDownloadName(row.fileName)}"`,
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
