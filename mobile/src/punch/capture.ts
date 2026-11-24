import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import type { CameraView } from 'expo-camera';

/** The server accepts at most 140,000 characters of photo data, including the data-URL prefix. */
const MAX_PHOTO_CHARS = 130_000;
const PREFIX = 'data:image/jpeg;base64,';

/**
 * Takes a live back-camera photo and shrinks it to a JPEG data URL under the server limit.
 * Gallery images are never used: the server rejects them.
 */
export async function captureLivePhoto(camera: CameraView): Promise<string> {
  const shot = await camera.takePictureAsync({ quality: 1, skipProcessing: true });
  if (!shot?.uri) throw new Error('The camera did not return a photo. Please try again.');

  for (const compress of [0.6, 0.4, 0.25]) {
    const out = await ImageManipulator.manipulateAsync(
      shot.uri,
      [{ resize: { width: 640 } }],
      { compress, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );
    if (!out.base64) continue;
    const photo = PREFIX + out.base64;
    if (photo.length <= MAX_PHOTO_CHARS) return photo;
  }
  throw new Error('The photo is too large. Please take it again.');
}

export interface DeviceLocation {
  lat: number;
  lng: number;
  accuracy: number | undefined;
  fixAgeMs: number;
  mocked: boolean;
}

/** GPS fix taken right now. Asks for permission on first use. */
export async function currentLocation(): Promise<DeviceLocation> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Location permission is needed to punch. Allow it in Settings and try again.');
  }
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy ?? undefined,
    fixAgeMs: Math.max(0, Date.now() - pos.timestamp),
    mocked: pos.mocked === true,
  };
}
