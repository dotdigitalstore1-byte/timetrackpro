"use client";

import { useEffect } from "react";
import { isNativeAppUserAgent } from "@/lib/app-platform-core";

export default function PwaRegister() {
  useEffect(() => {
    if (isNativeAppUserAgent(navigator.userAgent)) {
      // The mobile app never uses the service worker. Remove any left over from an earlier build, because a cached
      // page could show a web-only screen inside the app.
      void navigator.serviceWorker?.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()));
      if (typeof caches !== "undefined") {
        void caches.keys().then((keys) => keys.forEach((k) => void caches.delete(k)));
      }
      return;
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Service worker registration is optional; ignore failures
      });
    }
  }, []);
  return null;
}
