"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, clearMe } from "@/lib/client";
import { clearOfflineCache } from "@/lib/offline/store";

export default function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // The server clears the cookie regardless.
    }
    clearMe();
    clearOfflineCache();
    router.replace("/login");
    router.refresh();
  };
  return (
    <button type="button" onClick={signOut} disabled={busy} className={className}>
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
