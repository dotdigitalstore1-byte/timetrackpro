"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, clearMe } from "@/lib/client";
import { Button, Card, Input } from "@/components/ui";
import { BrandLockup } from "@/components/Brand";
import { homePathFor } from "@/lib/home";

export default function LoginPage() {
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
      const res = await api<{ role: string; home?: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier, password }),
      });
      clearMe();
      router.replace(res.home || homePathFor(res.role));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-gradient-to-br from-indigo-700 via-indigo-600 to-slate-900 px-4 pb-8 pt-20 sm:p-6">
      {/* Top-right entry point for Expert Specialists */}
      <Link
        href="/login/specialist"
        className="absolute right-4 top-4 inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3.5 py-2 text-xs font-semibold text-white shadow-sm backdrop-blur transition hover:bg-white/20 sm:right-6 sm:top-6 sm:text-sm"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        Expert Specialist Login
      </Link>

      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandLockup size="lg" tone="light" />
          <p className="mt-3 text-sm text-indigo-200">Attendance, leave and salary, in one place</p>
        </div>

        <Card className="p-5 sm:p-6">
          <h1 className="mb-4 text-lg font-bold text-slate-900">Sign in to your workspace</h1>
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
              placeholder="you@company.com or your username"
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
              Sign In
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-slate-500">
            New company?{" "}
            <Link href="/register" className="font-semibold text-indigo-600 hover:underline">
              Register your business
            </Link>
          </p>
        </Card>

        <p className="mt-4 text-center text-xs text-indigo-200">
          Employees sign in with their Email ID or username, and the password given by their company administrator.
        </p>
      </div>
    </div>
  );
}
