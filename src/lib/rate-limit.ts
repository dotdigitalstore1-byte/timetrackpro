import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";

/**
 * Fixed-window limiter backed by Postgres so it works across serverless
 * instances. Returns true when the caller is OVER the limit.
 */
export async function isRateLimited(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowSeconds * 1000);

  const rows = await db
    .insert(rateLimits)
    .values({ key, count: 1, resetAt })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.resetAt} <= ${now} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        resetAt: sql`CASE WHEN ${rateLimits.resetAt} <= ${now} THEN ${resetAt} ELSE ${rateLimits.resetAt} END`,
      },
    })
    .returning({ count: rateLimits.count });

  return (rows[0]?.count ?? 1) > max;
}

export async function clearRateLimit(key: string): Promise<void> {
  await db.delete(rateLimits).where(eq(rateLimits.key, key));
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}
