"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

export interface PermissionInfo {
  key: string;
  label: string;
  description: string;
}

export interface AccessData {
  isAdmin: boolean;
  isManager: boolean;
  permissions: string[];
  permissionCatalog: PermissionInfo[];
  departmentIds: string[];
  locationIds: string[];
}

export interface MeData {
  access: AccessData;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    phone: string | null;
  };
  company: {
    id: string;
    name: string;
    status: string;
    subscriptionPlan: string;
  } | null;
  settings: {
    shiftStart: string;
    shiftEnd: string;
    graceMinutes: number;
    lateThresholdMinutes: number;
    lateDeductionType: string;
    lateDeductionValue: string;
    halfDayDeductionType: string;
    halfDayDeductionValue: string;
    leaveDeductionType: string;
    leaveDeductionValue: string;
    unapprovedHoldDays: number;
    salaryHoldEnabled: boolean;
    salaryDisbursementDay: number;
    workDaysPerMonth: number;
    currency: string;
    approvalLevels: number;
    timezone: string;
  } | null;
  employee: {
    id: string;
    employeeCode: string | null;
    department: string | null;
    departments: { id: string; name: string }[];
    locations: { id: string; name: string }[];
    designation: string | null;
    shiftStart: string | null;
    shiftEnd: string | null;
    basicSalary: string;
    managerId: string | null;
  } | null;
}

/** Does the signed-in user hold this power? Admins hold every power; managers hold what the admin granted. */
export function hasPower(me: MeData | null | undefined, permission: string): boolean {
  if (!me) return false;
  return me.access.isAdmin || (me.access.isManager && me.access.permissions.includes(permission));
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * JSON fetch helper with a hard timeout and typed errors.
 * Never caches responses so attendance/salary data is always fresh.
 */
export async function api<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      signal: options.signal ?? controller.signal,
    });

    const text = await res.text();
    let data: unknown = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = {};
      }
    }

    if (!res.ok) {
      const message =
        (data as { error?: string }).error || `Request failed (${res.status})`;
      throw new ApiError(message, res.status);
    }
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new ApiError("The request timed out. Check your connection and try again.", 0);
    }
    throw new ApiError(e instanceof Error ? e.message : "Network error", 0);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- session store
// A single shared /api/auth/me request is used by every component that calls
// useMe(), instead of one network round-trip per hook instance.

interface MeState {
  data: MeData | null;
  error: string | null;
  loading: boolean;
}

const INITIAL_ME: MeState = { data: null, error: null, loading: true };
let meState: MeState = INITIAL_ME;
let mePromise: Promise<void> | null = null;
const meListeners = new Set<() => void>();

function emitMe() {
  for (const listener of meListeners) listener();
}

function setMe(patch: Partial<MeState>) {
  meState = { ...meState, ...patch };
  emitMe();
}

function loadMe(force = false): Promise<void> {
  if (mePromise && !force) return mePromise;
  if (!force && meState.data) return Promise.resolve();

  setMe({ loading: true });
  mePromise = (async () => {
    try {
      const data = await api<MeData>("/api/auth/me");
      setMe({ data, error: null, loading: false });
    } catch (e) {
      setMe({
        data: null,
        error: e instanceof Error ? e.message : "Failed to load session",
        loading: false,
      });
    } finally {
      mePromise = null;
    }
  })();
  return mePromise;
}

function subscribeMe(listener: () => void) {
  meListeners.add(listener);
  return () => {
    meListeners.delete(listener);
  };
}

function getMeSnapshot() {
  return meState;
}

function getMeServerSnapshot() {
  return INITIAL_ME;
}

/** Drop the cached session (call after login, logout or a password change). */
export function clearMe() {
  meState = INITIAL_ME;
  mePromise = null;
  emitMe();
}

export function useMe() {
  const state = useSyncExternalStore(subscribeMe, getMeSnapshot, getMeServerSnapshot);

  useEffect(() => {
    if (!state.data && !state.error) void loadMe();
  }, [state.data, state.error]);

  const refresh = useCallback(() => loadMe(true), []);

  return { me: state.data, loading: state.loading, error: state.error, refresh };
}

/** Current GPS fix. `fixAgeMs` is how old the device's reading is; the server refuses stale readings. */
export function getCurrentPosition(): Promise<{ lat: number; lng: number; accuracy: number; fixAgeMs: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation is not supported on this device"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          fixAgeMs: Math.max(0, Date.now() - pos.timestamp),
        }),
      (err) => reject(new Error(`Unable to get location: ${err.message}`)),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 } // always a fresh fix, never a cached one
    );
  });
}

/**
 * Runs `attempt` again only when the failure is temporary: a dropped connection, a timeout, or the server being
 * busy (502/503/504). Validation errors are never retried. Use it only for requests the server treats as idempotent.
 */
export async function withRetry<T>(attempt: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await attempt();
    } catch (e) {
      last = e;
      const temporary = e instanceof ApiError && (e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504);
      if (!temporary || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1) + Math.random() * 600));
    }
  }
  throw last;
}

export function downloadBlob(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
}