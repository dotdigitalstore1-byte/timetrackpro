"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { HiddenDetails, RestrictedProvider } from "@/components/HiddenDetails";

/** Personal pages that are blurred for an employee while their history is hidden. Profile stays open (contact details, password). */
const HISTORY_PAGES = ["/attendance", "/salary", "/leaves", "/agreements", "/notice"];

/**
 * Two things the app enforces for staff, without any message about the company's plan:
 *  - a forced password change: everything except the profile page is paused until the person sets their own password;
 *  - hidden history: personal pages are blurred and explain who can restore access. The server withholds the data too.
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

  const blurPage = restricted && HISTORY_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  return (
    <RestrictedProvider restricted={restricted}>
      {blurPage ? <HiddenDetails label="This page">{children}</HiddenDetails> : children}
    </RestrictedProvider>
  );
}
