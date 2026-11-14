"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, useMe } from "@/lib/client";
import { Badge, Button, Card, Input, PageHeader, Spinner } from "@/components/ui";
import LogoEditor from "@/components/LogoEditor";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Platform Super Admin",
  company_admin: "Company Admin",
  manager: "Manager",
  employee: "Employee",
};

export default function ProfilePage() {
  const { me, loading, refresh } = useMe();
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (me) {
      setFullName(me.user.fullName);
      setPhone(me.user.phone ?? "");
    }
  }, [me]);

  if (loading && !me) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  if (!me) {
    return (
      <Card>
        <p className="text-center text-sm text-slate-500">
          Your session has expired. Please sign in again.
        </p>
      </Card>
    );
  }

  const save = async () => {
    setMessage("");
    setError("");
    if (newPassword && newPassword !== confirmPassword) {
      setError("The new password and confirmation do not match.");
      return;
    }
    setSaving(true);
    try {
      await api("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({
          fullName,
          phone,
          ...(newPassword ? { currentPassword, newPassword } : {}),
        }),
      });
      setMessage(
        newPassword
          ? "Profile and password updated. Use the new password next time you sign in."
          : "Profile updated."
      );
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await refresh();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Profile" subtitle="Your account details and security" />

      {me.user.role === "company_admin" && (
        <div className="mb-4">
          <LogoEditor version={me.logoVersion} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-lg font-bold text-white">
              {(me.user.fullName || me.user.email)
                .split(/[\s@.]+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((s) => s[0]?.toUpperCase())
                .join("") || "U"}
            </div>
            <div className="min-w-0">
              <p className="truncate font-bold text-slate-900">{me.user.fullName}</p>
              <p className="truncate text-xs text-slate-500">{me.user.email}</p>
            </div>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Role</span>
              <Badge tone="indigo">{ROLE_LABEL[me.user.role] ?? me.user.role}</Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Company</span>
              <span className="truncate font-semibold text-slate-700">{me.company?.name ?? "Independent"}</span>
            </div>
            {me.employee?.designation && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Designation</span>
                <span className="truncate font-semibold text-slate-700">{me.employee.designation}</span>
              </div>
            )}
            {me.employee?.employeeCode && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-500">Employee code</span>
                <span className="truncate font-semibold text-slate-700">{me.employee.employeeCode}</span>
              </div>
            )}
          </div>
          <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-400">
            Need to change your company, salary or role? Ask your company administrator.
          </p>
        </Card>

        <Card className="lg:col-span-2">
          <h3 className="mb-3 font-bold text-slate-900">Account details</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Full name" value={fullName} onChange={setFullName} />
            <Input label="Phone" value={phone} onChange={setPhone} placeholder="Optional" />
          </div>

          <h3 className="mb-3 mt-6 font-bold text-slate-900">Change password</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Current password"
              type="password"
              value={currentPassword}
              onChange={setCurrentPassword}
              placeholder="Only needed to change password"
              className="sm:col-span-2"
            />
            <Input label="New password" type="password" value={newPassword} onChange={setNewPassword} placeholder="At least 8 characters" />
            <Input label="Confirm new password" type="password" value={confirmPassword} onChange={setConfirmPassword} />
          </div>

          {message && <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{message}</p>}
          {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}

          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => router.push(me.user.role === "super_admin" ? "/superadmin" : "/dashboard")}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving}>
              Save changes
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}