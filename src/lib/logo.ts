// Company logo helpers. The admin's crop is sent as a small PNG/JPEG/WebP data URL, stored in company_branding and
// served as a real image from /api/company/logo, so the logo is not inlined into every page's data.

/** Largest accepted logo, in characters of the data URL (about 150 KB of image). */
export const LOGO_MAX_CHARS = 200_000;

const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;

/** Returns the MIME type and decoded bytes, or null when the value is not an acceptable logo. */
export function parseLogoDataUrl(value: unknown): { mime: string; bytes: Uint8Array<ArrayBuffer> } | null {
  if (typeof value !== "string" || value.length > LOGO_MAX_CHARS) return null;
  const m = LOGO_RE.exec(value);
  if (!m) return null;
  const mime = `image/${m[1]}`;
  const bytes = new Uint8Array(Buffer.from(m[2], "base64"));
  if (bytes.byteLength === 0) return null;
  return { mime, bytes };
}
