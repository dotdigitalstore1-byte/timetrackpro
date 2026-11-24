import { punch, punchChallenge } from '../api/endpoints';
import { blockedMessage, readDeviceSecurity } from '../security/deviceSecurity';
import { currentLocation } from './capture';

export type PunchType = 'in' | 'out';

export interface PunchResult {
  duplicate: boolean;
}

interface RetryableError {
  offline?: boolean;
  status?: number;
}

function isRetryable(error: unknown): boolean {
  const e = error as RetryableError;
  return e.offline === true || (e.status ?? 0) >= 500;
}

/** One punch attempt: security check, fresh GPS and challenge, then the server call. */
async function attempt(type: PunchType, photo: string): Promise<PunchResult> {
  const before = readDeviceSecurity();
  if (before.blocked) throw new Error(blockedMessage(before));

  const [location, challenge] = await Promise.all([currentLocation(), punchChallenge()]);

  // Checked again after the GPS fix: the employee may have changed a setting while the camera was open.
  const after = readDeviceSecurity();
  if (after.blocked) throw new Error(blockedMessage(after));

  const result = await punch({
    type,
    photo,
    lat: location.lat,
    lng: location.lng,
    accuracy: location.accuracy,
    fixAgeMs: location.fixAgeMs,
    mockLocation: after.mockLocation || location.mocked,
    developerOptions: after.developerOptions,
    challenge,
  });
  return { duplicate: result.duplicate === true };
}

/**
 * Sends the punch. A dropped connection or a server error gets one retry with a fresh challenge. The server treats
 * a repeated punch as a success ("duplicate"), so a retry cannot record the punch twice.
 */
export async function submitPunch(type: PunchType, photo: string): Promise<PunchResult> {
  let lastError: unknown;
  for (let i = 0; i < 2; i++) {
    try {
      return await attempt(type, photo);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) throw error;
    }
  }
  throw lastError;
}
