// Pure id helpers (no database imports) so they can be unit-tested directly.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Accepts unknown input and returns a de-duplicated list of non-empty string ids. */
export function parseIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => String(v ?? "").trim()).filter(Boolean))];
}
