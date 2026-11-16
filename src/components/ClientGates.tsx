"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

const HISTORY_PAGES = ["/attendance", "/salary", "/leaves"];

/**
 * Two things the app enforces for staff, without any message about the company's plan:
 *  - a forced password change: everything except the profile page is paused until the person sets their own password;
 *  - hidden history: the personal logs show a neutral placeholder. The server withholds the data anyway.
 */
export default function ClientGates({
  children,
  restricted,
  forcePasswordChange,
}: {
  children: ReactNode;
  restricted: boolean;
  forcePasswordChange: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const mustChange = forcePasswordChange && !pathname.startsWith("/profile");

  useEffect(() => {
    if (mustChange) router.replace("/profile?set-password=1");
  }, [mustChange, router]);

  if (mustChange) return null;

  const hidden = restricted && HISTORY_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!hidden) return <>{children}</>;

  return (
    <div className="relative" role="region" aria-label="Details hidden">
      <div className="space-y-3 opacity-60" aria-hidden>
        <div className="h-24 rounded-2xl bg-slate-200/70 blur-[3px]" />
        <div className="h-40 rounded-2xl bg-slate-200/60 blur-[3px]" />
        <div className="h-56 rounded-2xl bg-slate-200/50 blur-[3px]" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-xs rounded-2xl bg-white/95 px-5 py-4 text-center shadow-lg ring-1 ring-slate-200">
          <p className="text-sm font-semibold text-slate-800">Contact Admin to see these details.</p>
        </div>
      </div>
    </div>
  );
}
