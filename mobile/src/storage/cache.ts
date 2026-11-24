import AsyncStorage from '@react-native-async-storage/async-storage';

// Last good response of each screen, so the app opens instantly and works offline with the last data it saw.
// Keys are scoped to the signed-in user, so one person's data never appears for another on the same phone.
const PREFIX = 'cache:';

export interface CacheEntry<T> {
  data: T;
  savedAt: number;
}

export async function readCache<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    return typeof parsed.savedAt === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, data: T, savedAt: number): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify({ data, savedAt }));
  } catch {
    // Losing a cache write only costs the instant start next time.
  }
}

/** Removes everything the app cached. Called on sign-out. */
export async function clearCache(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    if (keys.length > 0) await AsyncStorage.multiRemove(keys);
  } catch {
    // Nothing to do: the cache is also scoped per user.
  }
}
