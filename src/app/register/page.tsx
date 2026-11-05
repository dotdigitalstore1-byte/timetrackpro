"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, clearMe } from "@/lib/client";
import { Button, Card, Input } from "@/components/ui";

export default function RegisterPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError("");
    setLoading(true);
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          companyName, adminName, email, phone, password,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      clearMe();
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
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
          <h1 className="text-2xl font-bold text-white">Start your workspace</h1>
          <p className="text-sm text-indigo-200">14-day free trial · No credit card required</p>
        </div>

        <Card className="p-6">
          <h2 className="mb-4 text-lg font-bold text-slate-900">Register your company</h2>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Input label="Company name" value={companyName} onChange={setCompanyName} placeholder="Acme Corp" />
            <Input label="Your full name" value={adminName} onChange={setAdminName} placeholder="Jane Doe" />
            <Input label="Admin email" type="email" value={email} onChange={setEmail} placeholder="admin@acme.com" />
            <Input label="Phone (optional)" value={phone} onChange={setPhone} placeholder="+1 555 000 1234" />
            <Input label="Password (min 8 characters)" type="password" value={password} onChange={setPassword} placeholder="At least 8 characters" />
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
            <Button className="w-full" loading={loading} type="submit" disabled={!companyName || !adminName || !email || password.length < 8}>
              Create Workspace
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-slate-500">
            Already registered?{" "}
            <Link href="/login" className="font-semibold text-indigo-600 hover:underline">
              Sign in
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}