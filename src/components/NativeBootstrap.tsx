"use client";

import { useEffect } from "react";

/**
 * Hides the native splash screen (indigo, with the logo) once the first screen has painted, so the app never shows a
 * black or blank screen. A safety timer hides it anyway if the first paint is slow (for example, offline).
 */
export default function NativeBootstrap({ native }: { native: boolean }) {
  useEffect(() => {
    if (!native) return;
    let done = false;
    const hide = () => {
      if (done) return;
      done = true;
      import("@capacitor/splash-screen")
        .then((m) => m.SplashScreen.hide({ fadeOutDuration: 250 }))
        .catch(() => undefined);
    };
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(hide));
    const safety = window.setTimeout(hide, 6000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(safety);
    };
  }, [native]);
  return null;
}
