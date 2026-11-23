"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const getSnapshot = () => (typeof navigator === "undefined" ? true : navigator.onLine);
const getServerSnapshot = () => true;

/**
 * True when the device reports a connection. navigator.onLine can say "online" when the server is unreachable,
 * so requests still have to handle failure. This only drives the banner and when queued actions are sent.
 */
export function useIsOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
