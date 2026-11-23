import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { idempotencyKeys } from "@/db/schema";
import { parseIdempotencyKey } from "@/lib/idempotency-core";

/** Reads the Idempotency-Key header. A missing header means the request is not replay-protected. */
export function readIdempotencyKey(req: Request): { key: string | null; valid: boolean } {
  return parseIdempotencyKey(req.headers.get("idempotency-key"));
}

/** A previously stored successful response for this user and key, if any. */
export async function findStoredResponse(
  userId: string,
  key: string
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const [row] = await db
    .select({ status: idempotencyKeys.status, response: idempotencyKeys.response })
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)))
    .limit(1);
  return row ? { status: row.status, body: row.response } : null;
}

/** Stores a successful response. A concurrent duplicate that lost the race is ignored (the first write wins). */
export async function storeResponse(
  userId: string,
  key: string,
  status: number,
  body: Record<string, unknown>
): Promise<void> {
  await db
    .insert(idempotencyKeys)
    .values({ userId, key, status, response: body })
    .onConflictDoNothing();
}
