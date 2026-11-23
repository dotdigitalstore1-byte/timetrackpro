"use client";

import { useCallback, useEffect, useState } from "react";
import { blockedMessage, readDeviceSecurity, type DeviceSecurityStatus } from "@/lib/device-security";

/**
 * Locks the Android app while Developer Options or a mock-location (fake GPS) app is on. It checks on launch, every
 * time the app comes back to the foreground, and when the employee taps "Check again". It renders nothing on the web
 * and on iOS.
 */
export default function DeviceSecurityGate() {
  const [status, setStatus] = useState<DeviceSecurityStatus | null>(null);

  const check = useCallback(() => setStatus(readDeviceSecurity()), []);

  useEffect(() => {
    check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, [check]);

  if (!status?.blocked) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="device-lock-title"
      aria-describedby="device-lock-body"
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-5 bg-slate-950 px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-center text-white"
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/20 text-3xl" aria-hidden="true">
        ⚠
      </span>
      <h1 id="device-lock-title" className="text-xl font-extrabold">
        Attendance is locked
      </h1>
      <p id="device-lock-body" className="max-w-sm text-sm leading-relaxed text-slate-300">
        {blockedMessage(status)}
      </p>
      <p className="max-w-sm text-xs leading-relaxed text-slate-500">
        Punching in and out is not possible while this is on, so the app stays locked until you turn it off.
      </p>
      <button
        type="button"
        onClick={check}
        className="mt-2 min-h-12 rounded-xl bg-white px-6 text-sm font-bold text-slate-900 transition hover:bg-slate-100"
      >
        Check again
      </button>
    </div>
  );
}
