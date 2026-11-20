"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, clearMe } from "@/lib/client";
import { Button, Card, Input } from "@/components/ui";
import { BrandLockup } from "@/components/Brand";

/** Dedicated sign-in for Expert Specialists. The server rejects any other account type on this page. */
export default function SpecialistLoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      await api<{ role: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier, password, portal: "specialist" }),
      });
      clearMe();
      // Straight into the specialist queue, never the attendance screen.
      router.replace("/specialist");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-gradient-to-br from-violet-700 via-indigo-700 to-slate-900 px-4 pb-8 pt-20 sm:p-6">
      <Link
        href="/login"
        className="absolute left-4 top-4 inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3.5 py-2 text-xs font-semibold text-white backdrop-blur transition hover:bg-white/20 sm:left-6 sm:top-6 sm:text-sm"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Company &amp; employee sign-in
      </Link>

      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandLockup size="lg" tone="light" />
          <span className="mt-3 inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-violet-100">
            Expert Specialist Portal
          </span>
        </div>

        <Card className="p-5 sm:p-6">
          <h1 className="mb-1 text-lg font-bold text-slate-900">Expert Specialist Login</h1>
          <p className="mb-4 text-sm text-slate-500">Sign in to see the onboarding queue and your work.</p>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Input
              label="Email ID / Username"
              type="text"
              value={identifier}
              onChange={setIdentifier}
              placeholder="you@dotinout.com"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
            />
            <Input label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••" autoComplete="current-password" />
            <div className="-mt-1 text-right">
              <Link href="/forgot-password" className="text-xs font-semibold text-indigo-600 hover:underline">Forgot password?</Link>
            </div>
            {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
            <Button className="w-full" loading={loading} type="submit" disabled={!identifier.trim() || !password}>
              Sign In to Specialist Portal
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-xs text-indigo-200">Company admins and employees should use the main sign-in page.</p>
      </div>
    </div>
  );
}
