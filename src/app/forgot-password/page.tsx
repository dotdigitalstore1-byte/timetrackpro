"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { Button, Card, Input } from "@/components/ui";

type Step = "email" | "code" | "password" | "done";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const run = async (fn: () => Promise<void>) => {
    setError("");
    setLoading(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const requestCode = () =>
    run(async () => {
      const res = await api<{ resendSeconds: number }>("/api/auth/password/forgot", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setCooldown(res.resendSeconds);
      setCode("");
      setStep("code");
    });

  const verifyCode = () =>
    run(async () => {
      const res = await api<{ resetToken: string }>("/api/auth/password/verify", {
        method: "POST",
        body: JSON.stringify({ email, code }),
      });
      setResetToken(res.resetToken);
      setStep("password");
    });

  const savePassword = () =>
    run(async () => {
      if (password !== confirm) throw new Error("The two passwords do not match.");
      await api("/api/auth/password/reset", {
        method: "POST",
        body: JSON.stringify({ email, resetToken, password }),
      });
      setStep("done");
    });

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-indigo-700 via-indigo-600 to-slate-900 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-sm">
        <h1 className="mb-5 text-center text-2xl font-bold text-white">Reset your password</h1>
        <Card className="p-6">
          {step === "email" && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void requestCode(); }}>
              <p className="text-sm text-slate-600">Enter your work email. We will send you a 6-digit code.</p>
              <Input label="Email" type="email" value={email} onChange={setEmail} placeholder="you@company.com" />
              {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
              <Button className="w-full" type="submit" loading={loading} disabled={!email}>Send code</Button>
            </form>
          )}

          {step === "code" && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void verifyCode(); }}>
              <p className="text-sm text-slate-600">Enter the 6-digit code sent to <span className="font-semibold">{email}</span>.</p>
              <Input label="Code" value={code} onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} placeholder="000000" />
              {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
              <Button className="w-full" type="submit" loading={loading} disabled={code.length !== 6}>Verify code</Button>
              <button type="button" disabled={cooldown > 0 || loading} onClick={() => void requestCode()} className="w-full text-center text-sm font-semibold text-indigo-600 disabled:text-slate-400">
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
            </form>
          )}

          {step === "password" && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void savePassword(); }}>
              <p className="text-sm text-slate-600">Choose a new password (at least 8 characters).</p>
              <Input label="New password" type="password" value={password} onChange={setPassword} />
              <Input label="Confirm new password" type="password" value={confirm} onChange={setConfirm} />
              {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
              <Button className="w-full" type="submit" loading={loading} disabled={password.length < 8 || !confirm}>Save new password</Button>
            </form>
          )}

          {step === "done" && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-slate-700">Your password has been reset. Sign in with the new password.</p>
              <Button className="w-full" onClick={() => router.push("/login")}>Go to sign in</Button>
            </div>
          )}

          {step !== "done" && (
            <p className="mt-5 text-center text-sm text-slate-500">
              Remembered it? <Link href="/login" className="font-semibold text-indigo-600 hover:underline">Sign in</Link>
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
