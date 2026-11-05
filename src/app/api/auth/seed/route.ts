import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";

// One-time bootstrap for the Super Admin account using environment variables.
// Call: POST /api/auth/seed  (guarded by SUPER_ADMIN_SEED_KEY)
export async function POST(req: Request) {
  const body = await req.json();
  const key = String(body.key || "");
  if (!process.env.SUPER_ADMIN_SEED_KEY || key !== process.env.SUPER_ADMIN_SEED_KEY) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!email || !password) {
    return NextResponse.json({ error: "SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD env vars are not set." }, { status: 400 });
  }
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length) {
    await db
      .update(users)
      .set({
        passwordHash: hashPassword(password),
        fullName: "Super Admin",
        role: "super_admin",
        isActive: true,
      })
      .where(eq(users.email, email));
    return NextResponse.json({ ok: true, message: "Super admin updated" });
  }
  await db.insert(users).values({
    email,
    passwordHash: hashPassword(password),
    fullName: "Super Admin",
    role: "super_admin",
  });
  return NextResponse.json({ ok: true });
}