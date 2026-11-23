import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appDownloads, platformSettings } from "@/db/schema";
import type { AppPlatform } from "@/lib/app-links-core";

export interface AppFileInfo {
  platform: AppPlatform;
  fileName: string;
  sizeBytes: number;
  uploadedAt: string;
}

/** Store links and file details only. The file contents are never loaded here. */
export async function loadAppLinks(): Promise<{
  playStoreUrl: string | null;
  appStoreUrl: string | null;
  files: { android: AppFileInfo | null; ios: AppFileInfo | null };
}> {
  const [settings] = await db
    .select({ playStoreUrl: platformSettings.playStoreUrl, appStoreUrl: platformSettings.appStoreUrl })
    .from(platformSettings)
    .where(eq(platformSettings.id, 1))
    .limit(1);
  const rows = await db
    .select({
      platform: appDownloads.platform,
      fileName: appDownloads.fileName,
      sizeBytes: appDownloads.sizeBytes,
      uploadedAt: appDownloads.uploadedAt,
    })
    .from(appDownloads);

  const files: { android: AppFileInfo | null; ios: AppFileInfo | null } = { android: null, ios: null };
  for (const r of rows) {
    if (r.platform === "android" || r.platform === "ios") {
      files[r.platform] = {
        platform: r.platform,
        fileName: r.fileName,
        sizeBytes: r.sizeBytes,
        uploadedAt: r.uploadedAt.toISOString(),
      };
    }
  }
  return { playStoreUrl: settings?.playStoreUrl ?? null, appStoreUrl: settings?.appStoreUrl ?? null, files };
}
