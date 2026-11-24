/**
 * Developer Options and mock-location (fake GPS) checks for the Android app.
 *
 * The native side (android/app/src/main/java/com/dotinout/app/DeviceSecurity.java) exposes window.TimeTrackNative.
 * These checks apply only inside the Android app. On the web and on iOS they do not apply: iOS gives apps no way to
 * read Developer Options, and the web cannot read either setting.
 *
 * When the Android bridge is missing or cannot answer, the status is "unverified" and treated as blocked
 * (fail closed), so an old or broken build cannot punch around the check.
 */

export interface DeviceSecurityStatus {
  /** False on the web and on iOS, where the check does not apply. */
  applicable: boolean;
  /** True when attendance must be blocked until the employee turns the setting off. */
  blocked: boolean;
  /** True when the native check could not be completed. Always blocked. */
  unverified: boolean;
  developerOptions: boolean;
  mockLocation: boolean;
}

interface NativeBridge {
  securityStatus?: () => string;
}

const NOT_APPLICABLE: DeviceSecurityStatus = {
  applicable: false,
  blocked: false,
  unverified: false,
  developerOptions: false,
  mockLocation: false,
};

const UNVERIFIED: DeviceSecurityStatus = {
  applicable: true,
  blocked: true,
  unverified: true,
  developerOptions: false,
  mockLocation: false,
};

/** True inside the Android native shell shell (the shell adds "DotinoutNative/1" to the user agent). */
export function isAndroidNativeApp(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /DotinoutNative\//.test(ua) && /Android/i.test(ua);
}

/** Reads the current security status. Call on launch, on return to the app, and before every punch. */
export function readDeviceSecurity(): DeviceSecurityStatus {
  if (!isAndroidNativeApp()) return NOT_APPLICABLE;
  if (typeof window === "undefined") return UNVERIFIED;
  const bridge = (window as unknown as { TimeTrackNative?: NativeBridge }).TimeTrackNative;
  if (!bridge || typeof bridge.securityStatus !== "function") return UNVERIFIED;
  try {
    const parsed = JSON.parse(bridge.securityStatus()) as Record<string, unknown>;
    if (typeof parsed.blocked !== "boolean") return UNVERIFIED;
    return {
      applicable: true,
      blocked: parsed.blocked,
      unverified: false,
      developerOptions: parsed.developerOptions === true,
      mockLocation: parsed.mockLocation === true,
    };
  } catch {
    return UNVERIFIED;
  }
}

/** The message shown to the employee when attendance is blocked. */
export function blockedMessage(status: DeviceSecurityStatus): string {
  if (status.developerOptions && status.mockLocation) {
    return "Developer Options and a mock location (fake GPS) app are on. Turn both off in Android Settings, then check again.";
  }
  if (status.developerOptions) {
    return "Developer Options is turned on. For security, attendance is locked until you turn it off in Android Settings.";
  }
  if (status.mockLocation) {
    return "A mock location (fake GPS) app is active. Turn off mock location in Developer options, then check again.";
  }
  return "Dotinout could not check this device's security settings. Close the app, open it again, or update to the latest version.";
}
