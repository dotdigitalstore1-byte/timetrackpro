import { Platform } from 'react-native';
import DeviceSecurityNative from '../../modules/device-security';

/**
 * Developer Options and mock-location checks for punching. They run only on Android: iOS gives apps no way to read
 * Developer Options, the same limit the web app has. Android failures are treated as blocked (fail closed).
 */
export interface DeviceSecurityStatus {
  applicable: boolean;
  blocked: boolean;
  unverified: boolean;
  developerOptions: boolean;
  mockLocation: boolean;
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

export function readDeviceSecurity(): DeviceSecurityStatus {
  if (Platform.OS !== 'android') return NOT_APPLICABLE;
  if (!DeviceSecurityNative) return UNVERIFIED;
  try {
    const status = DeviceSecurityNative.getStatus();
    if (typeof status.blocked !== 'boolean') return UNVERIFIED;
    return {
      applicable: true,
      blocked: status.blocked,
      unverified: false,
      developerOptions: status.developerOptions === true,
      mockLocation: status.mockLocation === true,
    };
  } catch {
    return UNVERIFIED;
  }
}

export function blockedMessage(status: DeviceSecurityStatus): string {
  if (status.unverified) {
    return 'Attendance could not verify this phone’s security settings. Restart the app and try again.';
  }
  if (status.developerOptions && status.mockLocation) {
    return 'Developer Options and a mock location (fake GPS) app are on. Turn both off in Android Settings, then try again.';
  }
  if (status.developerOptions) {
    return 'Developer Options is turned on. For security, attendance is locked until you turn it off in Android Settings.';
  }
  return 'A mock location (fake GPS) app is active. Turn off mock location in Developer options, then try again.';
}
