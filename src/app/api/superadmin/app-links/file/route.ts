import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appDownloads } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { isAppPlatform, validateAppFile, MAX_APP_FILE_BYTES } from "@/lib/app-links-core";

async function requirePlatformOwner() {
  const ctx = await getAuth();
  if (!ctx) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (ctx.user.role !== "super_admin") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { ctx };
}

/** Upload the Android (.apk) or iOS (.ipa) package. Replaces any file already uploaded for that platform. */
export async function POST(req: Request) {
  const auth = await requirePlatformOwner();
  if (auth.error) return auth.error;
  const ctx = auth.ctx!;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  }
  const platform = form.get("platform");
  if (!isAppPlatform(platform)) return NextResponse.json({ error: "Choose Android or iOS." }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  if (file.size > MAX_APP_FILE_BYTES) {
    return NextResponse.json({ error: "The file is larger than 150 MB." }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const check = validateAppFile(platform, file.name, bytes.length, bytes.subarray(0, 4));
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const uploadedAt = new Date();
  const fileName = file.name.slice(0, 200);
  await db
    .insert(appDownloads)
    .values({
      platform,
      fileName,
      contentType: check.value.contentType,
      sizeBytes: bytes.length,
      data: bytes,
      uploadedAt,
      uploadedBy: ctx.user.id,
    })
    .onConflictDoUpdate({
      target: appDownloads.platform,
      set: {
        fileName,
        contentType: check.value.contentType,
        sizeBytes: bytes.length,
        data: bytes,
        uploadedAt,
        uploadedBy: ctx.user.id,
      },
    });

  return NextResponse.json({ ok: true, platform, fileName, sizeBytes: bytes.length, uploadedAt: uploadedAt.toISOString() });
}

/** Remove the uploaded package for one platform, which hides its direct download button. */
export async function DELETE(req: Request) {
  const auth = await requirePlatformOwner();
  if (auth.error) return auth.error;

  const platform = new URL(req.url).searchParams.get("platform");
  if (!isAppPlatform(platform)) return NextResponse.json({ error: "Choose Android or iOS." }, { status: 400 });
  await db.delete(appDownloads).where(eq(appDownloads.platform, platform));
  return NextResponse.json({ ok: true });
}
