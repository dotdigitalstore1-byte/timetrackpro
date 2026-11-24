import * as SecureStore from 'expo-secure-store';

// The bearer token lives in the Keychain (iOS) or the encrypted keystore (Android), never in plain storage.
const TOKEN_KEY = 'dotinout.session_token';
const USER_KEY = 'dotinout.user_id';

export const getToken = () => SecureStore.getItemAsync(TOKEN_KEY);

export const getStoredUserId = () => SecureStore.getItemAsync(USER_KEY);

/** Saves a new session. Any previous user id is removed first, so an old account is never paired with a new token. */
export async function saveSession(token: string, userId?: string): Promise<void> {
  await SecureStore.deleteItemAsync(USER_KEY);
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  if (userId) await SecureStore.setItemAsync(USER_KEY, userId);
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(USER_KEY);
}
