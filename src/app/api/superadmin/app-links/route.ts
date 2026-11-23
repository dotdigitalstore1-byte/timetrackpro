import { NextResponse } from "next/server";
import { db } from "@/db";
import { platformSettings } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { loadAppLinks } from "@/lib/app-downloads";
import { validateStoreUrl } from "@/lib/app-links-core";

async function requirePlatformOwner() {
  const ctx = await getAuth();
  if (!ctx) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (ctx.user.role !== "super_admin") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { ctx };
}

/** The Play Store and App Store links plus details of any uploaded app files. */
export async function GET() {
  const auth = await requirePlatformOwner();
  if (auth.error) return auth.error;
  return NextResponse.json(await loadAppLinks());
}

/** Save the two store links. An empty value clears a link. */
export async function PUT(req: Request) {
  const auth = await requirePlatformOwner();
  if (auth.error) return auth.error;
  const ctx = auth.ctx!;

  let body: { playStoreUrl?: unknown; appStoreUrl?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const play = validateStoreUrl("play", body.playStoreUrl);
  if (!play.ok) return NextResponse.json({ error: play.error }, { status: 400 });
  const appStore = validateStoreUrl("appstore", body.appStoreUrl);
  if (!appStore.ok) return NextResponse.json({ error: appStore.error }, { status: 400 });

  const now = new Date();
  await db
    .insert(platformSettings)
    .values({ id: 1, playStoreUrl: play.value, appStoreUrl: appStore.value, updatedAt: now, updatedBy: ctx.user.id })
    .onConflictDoUpdate({
      target: platformSettings.id,
      set: { playStoreUrl: play.value, appStoreUrl: appStore.value, updatedAt: now, updatedBy: ctx.user.id },
    });

  return NextResponse.json({ ok: true, ...(await loadAppLinks()) });
}
