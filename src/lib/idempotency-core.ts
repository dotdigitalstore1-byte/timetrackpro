// Pure validation for Idempotency-Key values (no database, so it can be unit-tested).
const KEY_RE = /^[A-Za-z0-9_-]{16,80}$/;

/** Returns the trimmed key, or null when the value is present but not a valid key. `undefined` means "no header". */
export function parseIdempotencyKey(raw: string | null | undefined): { key: string | null; valid: boolean } {
  if (raw === null || raw === undefined) return { key: null, valid: true };
  const key = raw.trim();
  return KEY_RE.test(key) ? { key, valid: true } : { key: null, valid: false };
}
