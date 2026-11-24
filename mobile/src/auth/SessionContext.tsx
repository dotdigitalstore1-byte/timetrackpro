import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { configureClient } from '../api/client';
import { login, logout, me } from '../api/endpoints';
import { toApiError } from '../api/errors';
import type { MeResponse } from '../api/types';
import { clearCache } from '../storage/cache';
import { clearSession, getStoredUserId, getToken, saveSession } from '../storage/session';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

export interface SessionUser {
  /** Null only when the server has never answered in this session (for example, signed in while offline). */
  id: string | null;
  fullName: string;
  role: string;
  companyName: string | null;
}

interface SessionValue {
  status: SessionStatus;
  user: SessionUser | null;
  /** Returns null on success, or the message to show. */
  signIn: (identifier: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

function toUser(res: MeResponse): SessionUser {
  return {
    id: res.user.id,
    fullName: res.user.fullName,
    role: res.user.role,
    companyName: res.company?.name ?? null,
  };
}

/** Owns sign-in state. The navigator shows the splash, the login screen or the app depending on this. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);

  const endSession = useCallback(async () => {
    await clearSession();
    await clearCache();
    setUser(null);
    setStatus('signedOut');
  }, []);

  // Registered before the restore effect below, so the first request already knows where the token is.
  useEffect(() => {
    configureClient({
      getToken,
      onUnauthorized: () => {
        void endSession();
      },
    });
  }, [endSession]);

  // On launch: a stored token is checked with the server. If the phone is offline the user stays signed in, so the
  // saved screens still open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      if (!token) {
        if (!cancelled) setStatus('signedOut');
        return;
      }
      try {
        const res = await me();
        if (!cancelled) {
          setUser(toUser(res));
          setStatus('signedIn');
        }
      } catch (error) {
        if (cancelled) return;
        const err = toApiError(error);
        if (err.unauthorized) {
          await endSession();
          return;
        }
        const storedId = await getStoredUserId();
        setUser({ id: storedId, fullName: '', role: 'employee', companyName: null });
        setStatus('signedIn');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endSession]);

  const signIn = useCallback(async (identifier: string, password: string): Promise<string | null> => {
    try {
      const res = await login(identifier, password);
      if (!res.token) return 'Sign-in failed. Please try again.';
      await saveSession(res.token);
      await clearCache();
      let signedInUser: SessionUser = { id: null, fullName: '', role: 'employee', companyName: null };
      try {
        signedInUser = toUser(await me());
        await saveSession(res.token, signedInUser.id ?? undefined);
      } catch {
        // The name is cosmetic and the session is already valid. It is filled in on the next launch.
      }
      setUser(signedInUser);
      setStatus('signedIn');
      return null;
    } catch (error) {
      return toApiError(error).message;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } catch {
      // The server session is revoked on its own when the token expires. The local copy is removed either way.
    }
    await endSession();
  }, [endSession]);

  const value = useMemo<SessionValue>(() => ({ status, user, signIn, signOut }), [status, user, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
