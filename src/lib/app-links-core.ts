// Pure validation for the Super Admin app-links section (no database, so it can be unit-tested).

export const MAX_APP_FILE_BYTES = 150 * 1024 * 1024;
export type AppPlatform = "android" | "ios";
export const APP_PLATFORMS: readonly AppPlatform[] = ["android", "ios"];

export type StoreKey = "play" | "appstore";
const STORE_HOSTS: Record<StoreKey, string[]> = {
  play: ["play.google.com"],
  appstore: ["apps.apple.com", "itunes.apple.com", "testflight.apple.com"],
};

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** An empty value clears the link. Otherwise it must be an https link to the store's own domain. */
export function validateStoreUrl(store: StoreKey, raw: unknown): Checked<string | null> {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, error: "The store link must be text." };
  const value = raw.trim();
  if (!value) return { ok: true, value: null };
  if (value.length > 500) return { ok: false, error: "The store link is too long (500 characters at most)." };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "Enter a full link that starts with https://." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "The store link must start with https://." };
  const host = url.hostname.toLowerCase();
  const allowed = STORE_HOSTS[store].some((h) => host === h || host.endsWith(`.${h}`));
  if (!allowed) {
    const names = STORE_HOSTS[store].join(" or ");
    return { ok: false, error: `This link must go to ${names}.` };
  }
  return { ok: true, value: url.toString() };
}

export function isAppPlatform(value: unknown): value is AppPlatform {
  return value === "android" || value === "ios";
}

/**
 * Checks an uploaded app file: right extension for the platform, within the size limit, and a real ZIP container
 * (APK and IPA files are both ZIP archives, so the first bytes must be "PK\x03\x04").
 */
export function validateAppFile(
  platform: AppPlatform,
  fileName: string,
  sizeBytes: number,
  firstBytes: Uint8Array
): Checked<{ contentType: string; extension: string }> {
  const extension = platform === "android" ? ".apk" : ".ipa";
  if (!fileName.toLowerCase().endsWith(extension)) {
    return { ok: false, error: `Choose a ${extension} file for ${platform === "android" ? "Android" : "iOS"}.` };
  }
  if (sizeBytes <= 0) return { ok: false, error: "The file is empty." };
  if (sizeBytes > MAX_APP_FILE_BYTES) {
    return { ok: false, error: `The file is larger than ${Math.round(MAX_APP_FILE_BYTES / (1024 * 1024))} MB.` };
  }
  const zipMagic = firstBytes.length >= 4 && firstBytes[0] === 0x50 && firstBytes[1] === 0x4b && firstBytes[2] === 0x03 && firstBytes[3] === 0x04;
  if (!zipMagic) return { ok: false, error: "This file is not a valid app package." };
  return {
    ok: true,
    value: {
      contentType: platform === "android" ? "application/vnd.android.package-archive" : "application/octet-stream",
      extension,
    },
  };
}

/** A safe download file name: letters, digits, dot, dash and underscore only. */
export function safeDownloadName(fileName: string): string {
  return fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 150) || "dotinout-app";
}

export const DEFAULT_REGISTRATION_URL = "https://dotinout.com";

/** The "Register your business" link. Any https website is allowed, and an empty value restores the default. */
export function validateRegistrationUrl(raw: unknown): Checked<string> {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: DEFAULT_REGISTRATION_URL };
  if (typeof raw !== "string") return { ok: false, error: "The registration link must be text." };
  const value = raw.trim();
  if (!value) return { ok: true, value: DEFAULT_REGISTRATION_URL };
  if (value.length > 500) return { ok: false, error: "The registration link is too long." };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "Enter a full link that starts with https://." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "The registration link must start with https://." };
  return { ok: true, value: url.toString() };
}
