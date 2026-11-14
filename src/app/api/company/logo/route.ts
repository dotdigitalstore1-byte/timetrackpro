import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, companyBranding } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { LOGO_MAX_CHARS, parseLogoDataUrl } from "@/lib/logo";

/**
 * The company logo as an image. Every signed-in member of the company can read it (it is shown in their app
 * header). The URL carries a version stamp (?v=...), so it can be cached for a long time and still refresh.
 */
export async function GET() {
  const ctx = await getAuth();
  if (!ctx || !ctx.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [row] = await db.select().from(companyBranding).where(eq(companyBranding.companyId, ctx.company.id)).limit(1);
  const logo = parseLogoDataUrl(row?.logoDataUrl ?? null);
  if (!logo) return NextResponse.json({ error: "No logo" }, { status: 404 });

  return new NextResponse(logo.bytes, {
    status: 200,
    headers: {
      "Content-Type": logo.mime,
      "Content-Length": String(logo.bytes.byteLength),
      "Cache-Control": "private, max-age=604800, immutable",
    },
  });
}

/** Company admin: save the cropped logo (a small PNG, JPEG or WebP data URL produced in the browser). */
export async function POST(req: Request) {
  const ctx = await getAuth();
  if (!ctx || !ctx.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Only the company admin can change the logo." }, { status: 403 });
  const companyId = ctx.company.id;

  let body: { logoDataUrl?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const logo = typeof body.logoDataUrl === "string" ? body.logoDataUrl : "";
  if (!logo || logo.length > LOGO_MAX_CHARS || !parseLogoDataUrl(logo)) {
    return NextResponse.json(
      { error: "The logo could not be saved. Crop it again so it is a PNG, JPEG or WebP image under about 150 KB." },
      { status: 400 }
    );
  }

  const now = new Date();
  const [saved] = await db
    .insert(companyBranding)
    .values({ companyId, logoDataUrl: logo, updatedAt: now })
    .onConflictDoUpdate({ target: companyBranding.companyId, set: { logoDataUrl: logo, updatedAt: now } })
    .returning({ updatedAt: companyBranding.updatedAt });

  await db.insert(auditLogs).values({
    companyId,
    actorId: ctx.user.id,
    action: "company.logo_update",
    entity: "company",
    entityId: companyId,
    details: {},
  });

  return NextResponse.json({ ok: true, version: saved?.updatedAt.getTime() ?? now.getTime() });
}

/** Company admin: remove the logo. The app falls back to the default mark. */
export async function DELETE() {
  const ctx = await getAuth();
  if (!ctx || !ctx.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.user.role !== "company_admin") return NextResponse.json({ error: "Only the company admin can change the logo." }, { status: 403 });
  const companyId = ctx.company.id;

  await db.delete(companyBranding).where(eq(companyBranding.companyId, companyId));
  await db.insert(auditLogs).values({
    companyId,
    actorId: ctx.user.id,
    action: "company.logo_remove",
    entity: "company",
    entityId: companyId,
    details: {},
  });
  return NextResponse.json({ ok: true });
}
