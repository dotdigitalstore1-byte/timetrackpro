"use client";

import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import { api, clearMe } from "@/lib/client";
import { Button, Card, Input } from "@/components/ui";
import { BrandLockup } from "@/components/Brand";
import { isNativeAppUserAgent } from "@/lib/app-platform-core";

/** Mobile app sign-in for employees only: username and password. No company or specialist options. */
export default function EmployeeLogin({ registrationUrl }: { registrationUrl: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // In the app, open the website in the device's own browser (Capacitor Browser plugin), never inside the app.
  const openRegistration = async (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!isNativeAppUserAgent(navigator.userAgent)) return; // normal link on the web
    e.preventDefault();
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: registrationUrl });
    } catch {
      window.open(registrationUrl, "_blank", "noopener,noreferrer");
    }
  };

  const submit = async () => {
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const res = await api<{ role: string; home?: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier: username, password }),
      });
      clearMe();
      router.replace(res.home || "/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-gradient-to-b from-indigo-700 via-indigo-600 to-indigo-800 px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(3rem+env(safe-area-inset-top))] text-white">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandLockup size="lg" tone="light" />
          <p className="mt-3 text-sm text-indigo-100">Employee sign in</p>
        </div>

        <Card className="p-5">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Input
              label="Username"
              type="text"
              value={username}
              onChange={setUsername}
              placeholder="your.username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              autoComplete="current-password"
            />
            {error && (
              <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                {error}
              </p>
            )}
            <Button className="w-full" type="submit" loading={loading} disabled={!username.trim() || !password}>
              Sign in
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-slate-600">
            Forgot your password? Contact your company admin to reset it.
          </p>
        </Card>

        <a
          href={registrationUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={openRegistration}
          className="mt-8 self-center rounded-full px-4 py-2 text-sm text-indigo-100 underline-offset-4 hover:text-white hover:underline"
        >
          New company? Register your business
        </a>
      </div>
    </div>
  );
}
