import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { USERNAME_MIN, USERNAME_MAX, parseUsername } from "@/lib/username-core";

export { USERNAME_MIN, USERNAME_MAX, EMAIL_NOT_ALLOWED, parseUsername } from "@/lib/username-core";
export type { UsernameParse } from "@/lib/username-core";

export interface UsernameStatus {
  available: boolean;
  message: string;
}

/** Checks a username against every account on the platform, not just one company. */
export async function usernameStatus(raw: string): Promise<UsernameStatus> {
  const parsed = parseUsername(raw);
  if (!parsed.ok) return { available: false, message: parsed.error };
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.username, parsed.value)).limit(1);
  if (taken) {
    return { available: false, message: "Unavailable. This username is already taken. Try a variation, such as adding an initial." };
  }
  return { available: true, message: "Available" };
}
