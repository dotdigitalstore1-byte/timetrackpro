"use client";

import { useRouter } from "next/navigation";
import { api, clearMe } from "@/lib/client";
import { Button, Card } from "@/components/ui";

/** Shown to staff only after the hard cutoff. It says nothing about plans or payment. */
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
        <h1 className="text-lg font-bold text-slate-900">This workspace is unavailable right now</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">Please contact your administrator for help getting back in.</p>
        <Button className="mt-5 w-full" variant="secondary" onClick={signOut}>Sign out</Button>
      </Card>
    </div>
  );
}
