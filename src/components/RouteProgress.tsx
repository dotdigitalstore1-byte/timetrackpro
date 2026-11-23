"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/** A thin top bar that appears as soon as an in-app link is tapped, so the app never feels frozen while a page loads. */
export default function RouteProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const link = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target || !link.getAttribute("href")?.startsWith("/")) return;
      if (link.getAttribute("href") === window.location.pathname) return;
      setActive(true);
      window.setTimeout(() => setActive(false), 8000); // never stuck on, even if navigation is cancelled
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    setActive(false);
  }, [pathname]);

  if (!active) return null;
  return (
    <div aria-hidden="true" className="fixed inset-x-0 top-0 z-[90] h-1 overflow-hidden bg-indigo-100">
      <div className="h-full w-1/3 animate-[dio-progress_1.1s_ease-in-out_infinite] rounded-full bg-indigo-600" />
    </div>
  );
}
