"use client";

import { useRouter } from "next/navigation";
import { api, clearMe } from "@/lib/client";
import { Button, Card } from "@/components/ui";

/**
 * Shown to staff once the app is fully locked (from day five after the subscription ends). It is the only screen they
 * see. It says nothing about plans or payments: it tells them who to contact, and that no data has been lost.
 */
export default function UnavailablePage() {
  const router = useRouter();
  const signOut = async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // best effort
    }
    clearMe();
    router.replace("/login");
  };
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 p-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <Card className="w-full max-w-sm p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.9L2.4 17.6A2 2 0 004.1 20.5h15.8a2 2 0 001.7-2.9L13.7 3.9a2 2 0 00-3.4 0z" />
          </svg>
        </div>
        <h1 className="mt-4 text-lg font-bold text-slate-900">Contact your Admin</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Access to this workspace is paused. Please contact your Company Admin, Owner or Reporting Manager to restore it.
        </p>
        <p className="mt-3 text-xs leading-relaxed text-slate-400">All attendance and salary records are safe and will be available again once access is restored.</p>
        <Button className="mt-5 w-full" variant="secondary" onClick={signOut}>Sign out</Button>
      </Card>
    </div>
  );
}
