"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

export interface MeData {
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

export function getCurrentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation is not supported on this device"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(`Unable to get location: ${err.message}`)),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  });
}

export function compressImage(file: File, maxSize = 640, quality = 0.6): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas not supported"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Could not read image"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export function capturePhoto(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "user";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error("No photo captured"));
        return;
      }
      try {
        resolve(await compressImage(file));
      } catch (e) {
        reject(e instanceof Error ? e : new Error("Photo processing failed"));
      }
    };
    input.click();
  });
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