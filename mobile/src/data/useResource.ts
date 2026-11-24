import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiError } from '../api/errors';
import { readCache, writeCache } from '../storage/cache';

export interface ResourceState<T> {
  data: T | null;
  savedAt: number | null;
  error: string | null;
  offline: boolean;
  loaded: boolean;
  refresh: () => void;
}

/** A cache key for one screen of one user. Null (no user yet) means nothing is cached or fetched. */
export function scopedKey(userId: string | null | undefined, name: string): string | null {
  return userId ? `${userId}:${name}` : null;
}

/**
 * Stale-while-revalidate. The saved copy is shown at once (if there is one), the server is asked in the background,
 * and the fresh answer replaces it. If the server cannot be reached, the saved copy stays and the reason is reported.
 * A bad or failed response never replaces the saved copy.
 */
export function useResource<T>(key: string | null, fetcher: () => Promise<T>): ResourceState<T> {
  const empty = { data: null as T | null, savedAt: null as number | null, error: null as string | null, offline: false, loaded: false };
  const [state, setState] = useState(empty);
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // A different user or month starts from empty.
  useEffect(() => {
    setState(empty);
    // Only the key should reset the state, not the empty object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let finished = false;
    (async () => {
      const cached = await readCache<T>(key);
      if (cached && !cancelled && !finished) {
        setState((s) => ({ ...s, data: cached.data, savedAt: cached.savedAt }));
      }
      try {
        const fresh = await fetcherRef.current();
        const savedAt = Date.now();
        await writeCache(key, fresh, savedAt);
        finished = true;
        if (!cancelled) setState({ data: fresh, savedAt, error: null, offline: false, loaded: true });
      } catch (error) {
        finished = true;
        const err = toApiError(error);
        if (!cancelled) setState((s) => ({ ...s, error: err.message, offline: err.offline, loaded: true }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, refresh };
}
