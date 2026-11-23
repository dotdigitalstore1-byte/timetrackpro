"use client";

/**
 * Small, dependency-free persistence for offline use. Everything here is per-device and is cleared on sign-out.
 * Never store passwords, session tokens or payment data in this module.
 */

const CACHE_PREFIX = "dio:cache:v1:";
const OUTBOX_KEY = "dio:outbox:v1";
const FAILED_KEY = "dio:outbox-failed:v1";

export const OFFLINE_CHANGED_EVENT = "dio:offline-changed";

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    // Accessing localStorage can throw (private mode, disabled storage). Probe once.
    const probe = "__dio_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OFFLINE_CHANGED_EVENT));
}

export interface CacheEntry<T> {
  value: T;
  savedAt: number;
}

/** Stores a snapshot of read-only data (profile, leave list, salary summary) for offline viewing. */
export function cacheWrite<T>(name: string, value: T): void {
  const s = storage();
  if (!s) return;
  try {
    const entry: CacheEntry<T> = { value, savedAt: Date.now() };
    s.setItem(CACHE_PREFIX + name, JSON.stringify(entry));
  } catch {
    // Quota exceeded: caching is best-effort, so the app keeps working without it.
  }
}

export function cacheRead<T>(name: string): CacheEntry<T> | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(CACHE_PREFIX + name);
    return raw ? (JSON.parse(raw) as CacheEntry<T>) : null;
  } catch {
    return null;
  }
}

export interface OutboxItem {
  /** Also the Idempotency-Key sent to the server, so a resend can never create a second record. */
  id: string;
  /** Only the account that queued the action may send it (a shared device must never send one user's data as another). */
  userId: string;
  url: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  body: string | null;
  label: string;
  createdAt: number;
  attempts: number;
}

export interface FailedItem {
  id: string;
  label: string;
  error: string;
  failedAt: number;
}

function readList<T>(key: string): T[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, list: T[]) {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(key, JSON.stringify(list));
  } catch {
    // Storage full: the caller is told by the absence of the item on next read.
  }
}

export const outboxList = (): OutboxItem[] => readList<OutboxItem>(OUTBOX_KEY);
export const outboxWrite = (list: OutboxItem[]) => {
  writeList(OUTBOX_KEY, list);
  notify();
};
export const failedList = (): FailedItem[] => readList<FailedItem>(FAILED_KEY);
export const failedWrite = (list: FailedItem[]) => {
  writeList(FAILED_KEY, list);
  notify();
};

/** Removes cached data on sign-out. Queued actions are kept on purpose: they are sent only if the same user signs in again. */
export function clearOfflineCache(): void {
  const s = storage();
  if (s) {
    try {
      for (let i = s.length - 1; i >= 0; i--) {
        const key = s.key(i);
        if (key && key.startsWith(CACHE_PREFIX)) s.removeItem(key);
      }
    } catch {
      // ignore
    }
  }
  // Cached HTML pages are per-user too; drop them as well.
  if (typeof caches !== "undefined") {
    void caches.delete("dotinout-pages-v1").catch(() => undefined);
  }
  notify();
}
