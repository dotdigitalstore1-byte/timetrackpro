"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, clearMe } from "@/lib/client";
import { Button, Card, Input } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const res = await api<{ role: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      clearMe();
      if (res.role === "super_admin") {
        router.replace("/superadmin");
      } else {
        router.replace("/dashboard");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-indigo-700 via-indigo-600 to-slate-900 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">TimeTrack Pro</h1>
          <p className="text-sm text-indigo-200">Attendance, leave & salary management</p>
        </div>

        <Card className="p-6">
          <h2 className="mb-4 text-lg font-bold text-slate-900">Sign in to your workspace</h2>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Input label="Email" type="email" value={email} onChange={setEmail} placeholder="you@company.com" />
            <Input label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••" />
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
            <Button className="w-full" loading={loading} type="submit" disabled={!email || !password}>
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
          Employees sign in with the email and password given by their company administrator.
        </p>
      </div>
    </div>
  );
}