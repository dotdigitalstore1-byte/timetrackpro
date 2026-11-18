"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError, clearMe } from "@/lib/client";
import { Button, Card, Input } from "@/components/ui";

interface Details {
  companyName: string;
  adminName: string;
  email: string;
  phone: string;
  password: string;
}

interface StartResponse {
  ok: true;
  email: string;
  delivery: "email" | "console";
  expiresInMinutes: number;
  resendSeconds: number;
}

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<"details" | "verify">("details");
  const [details, setDetails] = useState<Details>({ companyName: "", adminName: "", email: "", phone: "", password: "" });
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<StartResponse | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  // Resend cooldown ticker
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const requestCode = async () => {
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const payload = JSON.stringify({ ...details, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      const send = () => api<StartResponse>("/api/auth/register", { method: "POST", body: payload });
      // A request that never reached the server (a dropped connection on the first click) is sent once more.
      let res: StartResponse;
      try {
        res = await send();
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 0)) throw err;
        await new Promise((r) => setTimeout(r, 800));
        res = await send();
      }
      setSent(res);
      setStep("verify");
      setCode("");
      setCooldown(res.resendSeconds);
      setInfo(`We sent a 6-digit code to ${res.email}. It is valid for ${res.expiresInMinutes} minutes.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not send the code";
      setError(message);
      // A cooldown error means a code is already on its way; show the verify step rather than dead-ending.
      if (/wait \d+ seconds/.test(message) && sent) setStep("verify");
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    if (!sent || loading) return;
    setError("");
    setLoading(true);
    try {
      await api("/api/auth/register/verify", {
        method: "POST",
        body: JSON.stringify({ email: sent.email, code }),
      });
      clearMe();
      router.push("/dashboard");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
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
          <p className="text-sm text-indigo-200">20-day free trial · unlimited employees · No credit card required</p>
        </div>

        <Card className="p-6">
          <ol className="mb-5 flex items-center gap-2 text-xs font-semibold text-slate-500" aria-label="Sign-up progress">
            <li className={step === "details" ? "text-indigo-700" : "text-emerald-600"}>1 · Details</li>
            <li className="text-slate-300">——</li>
            <li className={step === "verify" ? "text-indigo-700" : ""}>2 · Verify email</li>
          </ol>

          {step === "details" && (
            <>
              <h2 className="mb-4 text-lg font-bold text-slate-900">Register your company</h2>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void requestCode();
                }}
              >
                <Input label="Company name" value={details.companyName} onChange={(v) => setDetails({ ...details, companyName: v })} placeholder="Acme Corp" />
                <Input label="Your full name" value={details.adminName} onChange={(v) => setDetails({ ...details, adminName: v })} placeholder="Jane Doe" />
                <Input label="Admin email" type="email" value={details.email} onChange={(v) => setDetails({ ...details, email: v })} placeholder="admin@acme.com" />
                <Input label="Phone (optional)" value={details.phone} onChange={(v) => setDetails({ ...details, phone: v })} placeholder="+91 98765 43210" />
                <Input label="Password (min 8 characters)" type="password" value={details.password} onChange={(v) => setDetails({ ...details, password: v })} placeholder="At least 8 characters" />
                {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
                <Button
                  className="w-full"
                  loading={loading}
                  type="submit"
                  disabled={!details.companyName || !details.adminName || !details.email || details.password.length < 8}
                >
                  Send verification code
                </Button>
              </form>
            </>
          )}

          {step === "verify" && sent && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void verify();
              }}
            >
              <h2 className="text-lg font-bold text-slate-900">Enter your verification code</h2>
              {info && <p className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800">{info}</p>}
              <p className="text-xs text-slate-500">The code expires in {sent.expiresInMinutes} minutes. Check your spam folder if it does not arrive.</p>
              <Input
                label="6-digit code"
                value={code}
                onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
              />
              {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
              <Button className="w-full" loading={loading} type="submit" disabled={code.length !== 6}>
                Verify and create workspace
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button type="button" className="font-semibold text-slate-500 hover:text-slate-800" onClick={() => setStep("details")}>
                  ← Change details
                </button>
                <button
                  type="button"
                  className="font-semibold text-indigo-600 hover:underline disabled:text-slate-400 disabled:no-underline"
                  disabled={cooldown > 0 || loading}
                  onClick={() => void requestCode()}
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                </button>
              </div>
            </form>
          )}

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
