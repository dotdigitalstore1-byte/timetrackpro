import { API_ORIGIN } from '../config';
import { ApiError, GENERIC_MESSAGE, OFFLINE_MESSAGE, SESSION_ENDED_MESSAGE } from './errors';

type TokenGetter = () => Promise<string | null>;

let getToken: TokenGetter = async () => null;
let onUnauthorized: (() => void) | null = null;

/** Called once by the session provider: where to read the bearer token, and what to do when the server rejects it. */
export function configureClient(options: { getToken: TokenGetter; onUnauthorized: () => void }): void {
  getToken = options.getToken;
  onUnauthorized = options.onUnauthorized;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  /** Extra headers, for example Idempotency-Key on leave requests. */
  headers?: Record<string, string>;
  /** False for sign-in, which has no token yet. */
  auth?: boolean;
  timeoutMs?: number;
}

/**
 * One request to the Dotinout server. The bearer token is added here, server messages are shown as they are, and
 * network failures become the offline message. The app never shows raw network errors.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, timeoutMs = 20000, headers: extraHeaders = {} } = options;
  const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(OFFLINE_MESSAGE, { offline: true });
  } finally {
    clearTimeout(timer);
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new ApiError(OFFLINE_MESSAGE, { offline: true });
  }
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (response.status === 401 && auth) {
    onUnauthorized?.();
    throw new ApiError(SESSION_ENDED_MESSAGE, { status: 401, unauthorized: true });
  }
  if (!response.ok) {
    const serverMessage =
      json !== null && typeof (json as { error?: unknown }).error === 'string' ? (json as { error: string }).error : null;
    const message =
      serverMessage ??
      (response.status >= 500 || json === null
        ? `Something went wrong (error ${response.status}). Please try again.`
        : GENERIC_MESSAGE);
    throw new ApiError(message, { status: response.status });
  }
  return (json ?? {}) as T;
}
