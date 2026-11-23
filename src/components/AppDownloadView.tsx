"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api, clearMe } from "@/lib/client";
import { clearOfflineCache } from "@/lib/offline/store";
import type { AppFileInfo } from "@/lib/app-downloads";
import { BrandLockup } from "@/components/Brand";

interface Props {
  employeeName: string;
  playStoreUrl: string | null;
  appStoreUrl: string | null;
  androidFile: AppFileInfo | null;
  iosFile: AppFileInfo | null;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Google Play mark (simplified four-colour triangle). Replace with the official badge artwork before launch. */
function PlayLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <path d="M3.6 2.1 13.4 12 3.6 21.9c-.3-.2-.6-.6-.6-1.2V3.3c0-.6.3-1 .6-1.2z" fill="#00d7fe" />
      <path d="M16.7 8.7 13.4 12l3.3 3.3 3.9-2.2c.8-.5.8-1.6 0-2.1z" fill="#ffce00" />
      <path d="M3.6 2.1c.3-.1.7 0 1.1.2l11.6 6.5-3.3 3.2z" fill="#00f076" />
      <path d="M3.6 21.9l8.3-8.3 3.3 3.2-11.6 6.5c-.4.2-.8.3-1.1.2z" fill="#ff3a44" />
    </svg>
  );
}

/** App Store mark (simplified blue tile with an "A"). Replace with the official badge artwork before launch. */
function AppStoreLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
      <defs>
        <linearGradient id="dio-appstore" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2aa7ff" />
          <stop offset="1" stopColor="#1268f0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="url(#dio-appstore)" />
      <path d="M12 6.2 8.2 17.4h2.1l.8-2.4h2.8l.8 2.4h2.1L12 6.2zm0 3.1 1 2.9h-2z" fill="#fff" />
    </svg>
  );
}

function StoreButton({ href, label, sub, logo }: { href: string | null; label: string; sub: string; logo: ReactNode }) {
  const base = "flex w-full items-center gap-3 rounded-2xl px-5 py-3.5 text-left shadow-sm transition sm:w-auto sm:min-w-[260px]";
  if (!href) {
    // Visible but not clickable until the Super Admin adds the link.
    return (
      <div aria-disabled="true" className={`${base} cursor-not-allowed bg-slate-200 text-slate-500`}>
        {logo}
        <span className="min-w-0">
          <span className="block text-xs font-medium">{sub}</span>
          <span className="block text-base font-bold">{label}</span>
          <span className="block text-[11px]">Link not added yet</span>
        </span>
      </div>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${base} bg-slate-900 text-white hover:bg-slate-800`}>
      {logo}
      <span className="min-w-0">
        <span className="block text-xs font-medium text-slate-300">{sub}</span>
        <span className="block text-base font-bold">{label}</span>
      </span>
    </a>
  );
}

export default function AppDownloadView({ employeeName, playStoreUrl, appStoreUrl, androidFile, iosFile }: Props) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // The session cookie is cleared by the server either way.
    }
    clearMe();
    clearOfflineCache();
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="min-h-dvh bg-gradient-to-br from-indigo-700 via-indigo-600 to-slate-900 px-4 pb-10 pt-[calc(2rem+env(safe-area-inset-top))] text-white sm:px-6">
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <BrandLockup size="lg" tone="light" />

        <div className="mt-8 w-full rounded-3xl bg-white p-6 text-slate-900 shadow-xl sm:p-8">
          <h1 className="text-2xl font-extrabold tracking-tight">Hi {employeeName}, use the Dotinout app</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Punch in and out, request leave and see your salary slips in the Dotinout mobile app. The web app is for
            company admins and managers, so attendance actions are not available here.
          </p>

          <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
            <StoreButton href={playStoreUrl} sub="GET IT ON" label="Google Play" logo={<PlayLogo />} />
            <StoreButton href={appStoreUrl} sub="Download on the" label="App Store" logo={<AppStoreLogo />} />
          </div>

          {(androidFile || iosFile) && (
            <div className="mt-8 border-t border-slate-200 pt-6">
              <h2 className="text-sm font-bold text-slate-800">Direct download</h2>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:justify-center">
                {androidFile && (
                  <a
                    href="/api/app-downloads/android"
                    className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-700"
                  >
                    Download for Android
                    <span className="block text-xs font-medium text-emerald-100">
                      {androidFile.fileName} · {formatSize(androidFile.sizeBytes)}
                    </span>
                  </a>
                )}
                {iosFile && (
                  <a
                    href="/api/app-downloads/ios"
                    className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-slate-800"
                  >
                    Download for iPhone
                    <span className="block text-xs font-medium text-slate-300">
                      {iosFile.fileName} · {formatSize(iosFile.sizeBytes)}
                    </span>
                  </a>
                )}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Android: allow installs from this source when prompted. iPhone: the file installs only on devices your
                company has enrolled, so use the App Store or TestFlight link where possible.
              </p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          className="mt-6 rounded-full border border-white/30 px-5 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-60"
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
