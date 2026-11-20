// Pure username rules (no database), so they can be tested directly.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const EMAIL_NOT_ALLOWED = "Email IDs are not accepted here. Please enter a username.";

export type UsernameParse = { ok: true; value: string } | { ok: false; error: string };

/**
 * Usernames are lowercase, unique across the whole platform, and may use any characters except spaces and "@".
 * "@" is blocked so a username can never look like (or collide with) an email ID.
 */
export function parseUsername(raw: string): UsernameParse {
  const value = raw.trim().toLowerCase();
  if (!value) return { ok: false, error: "Enter a username." };
  if (value.includes("@")) return { ok: false, error: EMAIL_NOT_ALLOWED };
  if (/\s/.test(value)) return { ok: false, error: "Usernames cannot contain spaces." };
  if (value.length < USERNAME_MIN || value.length > USERNAME_MAX) {
    return { ok: false, error: `Usernames must be ${USERNAME_MIN} to ${USERNAME_MAX} characters.` };
  }
  return { ok: true, value };
}
