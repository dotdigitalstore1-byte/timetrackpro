"use client";

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { isNetworkError } from "@/lib/client";
import { cacheRead, cacheWrite } from "@/lib/offline/store";

/**
 * Stale-while-revalidate data for the tab screens (Home, Attendance, Leaves, Salary).
 *
 * - Every key includes the signed-in user's id, so a shared phone never shows one person's data to another.
 * - A screen renders the last copy at once (from memory, then from the device copy), with no spinner, and refreshes
 *   it in the background. The spinner shows only when there is no copy at all yet.
 * - Offline with no copy: the screen shows a clear message instead of an endless loader.
 * - Copies are cleared on sign-out (clearOfflineCache removes the device copy; clearResourceMemory the in-memory one).
 */

const memory = new Map<string, unknown>();
const freshAt = new Map<string, number>();
/** A copy fetched this recently (for example by the launch prefetch) is not fetched again when a screen mounts. */
const FRESH_MS = 15_000;

const NO_COPY_OFFLINE = "No connection, and this screen has not been saved on this device yet. It will load when you are back online.";

export interface CachedResource<T> {
  data: T | null;
  /** True only while there is no copy at all and the first load is still running. */
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
}

function failureMessage(e: unknown, hasCopy: boolean): string {
  if (isNetworkError(e)) return hasCopy ? "" : NO_COPY_OFFLINE; // a saved copy is shown silently; the offline banner says so
  return e instanceof Error ? e.message : "Could not load this screen";
}

function store(key: string, value: unknown) {
  memory.set(key, value);
  freshAt.set(key, Date.now());
  cacheWrite(key, value);
}

/** Warms a copy in the background (at launch), so the next tab opens with data already on screen. Failures are ignored. */
export async function prefetchResource(key: string, fetcher: () => Promise<unknown>): Promise<void> {
  try {
    store(key, await fetcher());
  } catch {
    // best effort
  }
}

/** Drops the in-memory copies on sign-out. Device copies are removed by clearOfflineCache. */
export function clearResourceMemory(): void {
  memory.clear();
  freshAt.clear();
}

/**
 * Returns the last saved copy for `key` immediately and refreshes it in the background.
 * Pass `key = null` while the data must not be loaded yet (for example before the session is known).
 */
export function useCachedResource<T>(key: string | null, fetcher: () => Promise<T>): CachedResource<T> {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

  // Always the fetcher of the current render, without making the effects below depend on a new function each time.
  const fetcherRef = useRef(fetcher);
  useLayoutEffect(() => {
    fetcherRef.current = fetcher;
  });

  // Before the first paint, seed the screen from the device copy. Client-only, so server rendering still matches.
  useLayoutEffect(() => {
    if (!key || memory.has(key)) return;
    const saved = cacheRead<T>(key);
    if (saved) {
      memory.set(key, saved.value);
      bump();
    }
  }, [key]);

  const reload = useCallback(async () => {
    if (!key) return;
    try {
      store(key, await fetcherRef.current());
      setFailure(null);
    } catch (e) {
      setFailure({ key, message: failureMessage(e, memory.has(key)) });
    } finally {
      setSettledKey(key);
      bump();
    }
  }, [key]);

  // Refresh when the screen opens, unless a copy was just fetched (launch prefetch).
  useEffect(() => {
    if (!key) return;
    const recent = (freshAt.get(key) ?? 0) > Date.now() - FRESH_MS;
    if (!recent) void reload();
  }, [key, reload]);

  // Refresh as soon as the connection returns.
  useEffect(() => {
    if (!key) return;
    const onOnline = () => void reload();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [key, reload]);

  const data = key ? ((memory.get(key) as T | undefined) ?? null) : null;
  return {
    data,
    loading: !!key && data === null && settledKey !== key && failure?.key !== key,
    error: key && failure?.key === key ? failure.message : "",
    reload,
  };
}
