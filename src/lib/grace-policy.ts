import { eq } from "drizzle-orm";
import { db } from "@/db";
import { platformSettings } from "@/db/schema";
import { DEFAULT_GRACE_POLICY, type GracePolicy } from "@/lib/billing-core";

const CACHE_MS = 60_000;
let cached: { policy: GracePolicy; at: number } | null = null;

/**
 * The platform's grace policy. Cached for a minute per server instance, so a change made in the admin panel
 * takes effect everywhere within about a minute without a query on every request.
 */
export async function loadGracePolicy(): Promise<GracePolicy> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.policy;
  try {
    const [row] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1)).limit(1);
    const policy: GracePolicy = row
      ? {
          blurAfterDays: row.graceBlurAfterDays,
          punchUntilDays: row.gracePunchUntilDays,
          blockAfterDays: row.graceBlockAfterDays,
        }
      : DEFAULT_GRACE_POLICY;
    cached = { policy, at: Date.now() };
    return policy;
  } catch {
    // Table not migrated yet: keep the documented defaults rather than failing every request.
    return DEFAULT_GRACE_POLICY;
  }
}

/** Forget the cached value (called right after the admin saves a change). */
export function clearGracePolicyCache(): void {
  cached = null;
}
