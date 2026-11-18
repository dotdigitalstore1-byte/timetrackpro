// Company codes: the rules and the generator. Runs in the browser and on the server (uses Web Crypto, no Node imports).
// Codes look like CO-7K3D-9PMQ. The alphabet leaves out 0, O, 1, I and L so codes are easy to read aloud and type.

export const COMPANY_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const COMPANY_CODE_BODY_LENGTH = 8;

/** A new random code. `pick(n)` returns an integer in [0, n) and can be injected in tests. */
export function generateCompanyCode(pick: (n: number) => number = randomIndex): string {
  let body = "";
  for (let i = 0; i < COMPANY_CODE_BODY_LENGTH; i++) body += COMPANY_CODE_ALPHABET[pick(COMPANY_CODE_ALPHABET.length)];
  return `CO-${body.slice(0, 4)}-${body.slice(4)}`;
}

function randomIndex(n: number): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] % n;
}
const CANONICAL = /^CO-([2-9A-HJ-NP-Z]{4})-([2-9A-HJ-NP-Z]{4})$/;

/** Turns whatever the admin typed into the canonical form, or null when it cannot be a company code. */
export function normalizeCompanyCode(input: string | null | undefined): string | null {
  const compact = String(input ?? "").toUpperCase().replace(/[\s-]/g, "");
  const match = /^CO([2-9A-HJ-NP-Z]{4})([2-9A-HJ-NP-Z]{4})$/.exec(compact);
  if (!match) return null;
  return `CO-${match[1]}-${match[2]}`;
}

export function isCompanyCode(value: string | null | undefined): boolean {
  return CANONICAL.test(String(value ?? ""));
}
