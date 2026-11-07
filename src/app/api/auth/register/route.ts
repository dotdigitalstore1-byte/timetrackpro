import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { companies, companySettings, subscriptions, users } from "@/db/schema";
import { hashPassword, createSession, setSessionCookie } from "@/lib/auth";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { isValidTimezone } from "@/lib/payroll";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const companyName = String(body.companyName || "").trim();
    const adminName = String(body.adminName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const phone = String(body.phone || "").trim();

    if (await isRateLimited(`register:ip:${clientIp(req)}`, 5, 3600)) {
      return NextResponse.json({ error: "Too many sign-ups from this network. Please try again later." }, { status: 429 });
    }
    if (!companyName || !adminName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length < 8) {
      return NextResponse.json({ error: "Please fill all fields with a valid email and a password of at least 8 characters." }, { status: 400 });
    }

    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }

    const company = await db.insert(companies).values({ name: companyName, email, phone }).returning();
    const companyId = company[0].id;

    const tz = String(body.timezone || "");
    await db.insert(companySettings).values({ companyId, timezone: isValidTimezone(tz) ? tz : "UTC" });
    await db
      .insert(subscriptions)
      .values({
        companyId,
        plan: "trial",
        amount: "0",
        status: "active",
        endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      });

    const admin = await db
      .insert(users)
      .values({
        companyId,
        email,
        passwordHash: hashPassword(password),
        fullName: adminName,
        role: "company_admin",
        phone,
      })
      .returning();


    const token = await createSession(admin[0].id);
    await setSessionCookie(token);

    return NextResponse.json({ ok: true, companyId, name: adminName });
  } catch (e) {
    console.error("register error", e);
    return NextResponse.json({ error: "Registration failed. Please try again." }, { status: 500 });
  }
}