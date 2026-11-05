import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { getAuth, hashPassword, verifyPassword } from "@/lib/auth";

// Self-service profile update for any signed-in user (including super admins).
export async function PATCH(req: Request) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  if (typeof body.fullName === "string") {
    const fullName = body.fullName.trim();
    if (!fullName) return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
    update.fullName = fullName.slice(0, 200);
  }

  if (typeof body.phone === "string") {
    const phone = body.phone.trim().slice(0, 50);
    update.phone = phone || null;
  }

  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (newPassword) {
    if (newPassword.length < 8) {
      return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
    }
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    if (!currentPassword || !verifyPassword(currentPassword, ctx.user.passwordHash)) {
      return NextResponse.json({ error: "Your current password is incorrect." }, { status: 400 });
    }
    update.passwordHash = hashPassword(newPassword);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  await db.update(users).set(update).where(eq(users.id, ctx.user.id));

  if (ctx.company) {
    await db.insert(auditLogs).values({
      companyId: ctx.company.id,
      actorId: ctx.user.id,
      action: "profile.update",
      entity: "user",
      entityId: ctx.user.id,
      details: { passwordChanged: !!newPassword },
    });
  }

  return NextResponse.json({ ok: true });
}