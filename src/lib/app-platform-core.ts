// Pure helpers for telling the Dotinout mobile app apart from a browser (no framework imports, so they are testable).
// Capacitor appends this token to the WebView's user agent (see capacitor.config.ts, appendUserAgent).
export const NATIVE_APP_UA_TOKEN = "DotinoutNative";

/**
 * True when the request comes from the Dotinout Capacitor app. This is a policy gate for the employee app, not a
 * strong security boundary: a browser can copy the token. Punch-ins still need the session-bound challenge, a live
 * photo and a fresh GPS fix. Stronger device attestation (Play Integrity / App Attest) is the next step.
 */
export function isNativeAppUserAgent(userAgent: string | null | undefined): boolean {
  return !!userAgent && userAgent.includes(NATIVE_APP_UA_TOKEN);
}
