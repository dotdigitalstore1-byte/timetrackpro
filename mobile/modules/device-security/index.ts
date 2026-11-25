import { NativeModules } from 'react-native';

export interface NativeSecurityStatus {
  developerOptions: boolean;
  mockLocation: boolean;
  blocked: boolean;
}

interface DeviceSecurityModuleType {
  getStatus(): NativeSecurityStatus;
}

/**
 * The native module is not linked in this build (see the README), so this is undefined and the app
 * treats it as unverified (blocked). Read through NativeModules so no extra package import is needed.
 */
const mod = (NativeModules as { DeviceSecurity?: DeviceSecurityModuleType }).DeviceSecurity;
export default mod ?? null;
