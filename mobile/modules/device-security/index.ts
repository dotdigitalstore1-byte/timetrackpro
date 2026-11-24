import { requireOptionalNativeModule } from 'expo-modules-core';

export interface NativeSecurityStatus {
  developerOptions: boolean;
  mockLocation: boolean;
  blocked: boolean;
}

interface DeviceSecurityModuleType {
  getStatus(): NativeSecurityStatus;
}

/** Null on iOS and in any build where the native module is not linked. The app treats null as unverified. */
export default requireOptionalNativeModule<DeviceSecurityModuleType>('DeviceSecurity');
