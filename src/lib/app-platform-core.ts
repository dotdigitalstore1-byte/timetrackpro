// Pure helpers for telling the Dotinout mobile app apart from a browser (no framework imports, so they are testable).
//
// Two signals identify the app, and either one is enough:
//  1. The user-agent token "DotinoutNative/1", which Capacitor appends to the WebView user agent (capacitor.config.ts).
//  2. A cookie "dio_native=1". Middleware sets it on the first request that carries the token. It is kept on the device,
//     so a cold start or a background fetch that loses the user-agent still opens the app's own screens.
//
// This is a policy gate, not a hard security boundary: a browser can copy the token or the cookie. Punch-ins still need
// the session-bound challenge, a live photo and a fresh GPS fix. Stronger device attestation (Play Integrity /
// App Attest) is the next step.
export const NATIVE_APP_UA_TOKEN = "DotinoutNative";
export const NATIVE_APP_COOKIE = "dio_native";

export function isNativeAppUserAgent(userAgent: string | null | undefined): boolean {
  return !!userAgent && userAgent.includes(NATIVE_APP_UA_TOKEN);
}

/** Reads one cookie from a Cookie request header. */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Native if either signal is present. Used by route handlers and sign-in. */
export function isNativeRequestHeaders(userAgent: string | null | undefined, cookieHeader: string | null | undefined): boolean {
  return isNativeAppUserAgent(userAgent) || readCookie(cookieHeader, NATIVE_APP_COOKIE) === "1";
}
