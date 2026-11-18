"use client";

import { createContext, useContext, useState, type KeyboardEvent, type ReactNode } from "react";
import { CONTACT_ADMIN_MESSAGE } from "@/lib/billing-core";

/**
 * True when the signed-in employee's history is hidden (the company's subscription has ended, within the grace window).
 * The layout provides it once; any section can then be wrapped in <HiddenDetails>.
 */
const RestrictedContext = createContext(false);

export function RestrictedProvider({ restricted, children }: { restricted: boolean; children: ReactNode }) {
  return <RestrictedContext.Provider value={restricted}>{children}</RestrictedContext.Provider>;
}

export function useRestricted(): boolean {
  return useContext(RestrictedContext);
}

/**
 * Blurs its content while the employee's details are hidden. Tapping or clicking the blurred area explains who can
 * restore access. The server withholds the underlying data too; this is the on-screen behaviour.
 */
export function HiddenDetails({ children, label = "These details" }: { children: ReactNode; label?: string }) {
  const restricted = useRestricted();
  const [open, setOpen] = useState(false);
  if (!restricted) return <>{children}</>;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${label} are hidden. Tap to see why.`}
      aria-expanded={open}
      onClick={() => setOpen(true)}
      onKeyDown={onKey}
      className="relative cursor-pointer rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
    >
      <div aria-hidden className="pointer-events-none select-none blur-[5px] opacity-70">
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center p-3">
        <div className="w-full max-w-sm rounded-2xl bg-white/95 px-5 py-4 text-center shadow-lg ring-1 ring-slate-200">
          {open ? (
            <>
              <p className="text-sm font-semibold text-slate-800">Details are hidden</p>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{CONTACT_ADMIN_MESSAGE}</p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                }}
                className="mt-3 text-xs font-semibold text-indigo-600 hover:underline"
              >
                Close
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-slate-800">{label} are hidden</p>
              <p className="mt-1 text-xs text-slate-500">Tap to see why</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
