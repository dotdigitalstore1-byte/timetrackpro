"use client";

import { useState } from "react";
import { api } from "@/lib/client";
import { Button } from "@/components/ui";

/** Admin-only controls for one employee, shown inside the edit panel. */
export default function EmployeeAdminActions({
  employeeId,
  fullName,
  role,
  isActive,
  onChanged,
}: {
  employeeId: string;
  fullName: string;
  role: string;
  isActive: boolean;
  onChanged: (message: string) => void;
}) {
  const [tempPassword, setTempPassword] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    setError("");
    try {
      onChanged(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const promote = () => {
    if (!window.confirm(`Promote ${fullName} to manager? Their employee profile will be switched off. Their history is kept, and you choose their manager powers next.`)) return;
    void run("promote", async () => {
      await api(`/api/employees/${employeeId}/promote`, { method: "POST" });
      return `${fullName} is now a manager. Set their powers on the Managers page.`;
    });
  };

  const setTemporary = () =>
    void run("password", async () => {
      await api(`/api/employees/${employeeId}`, { method: "PATCH", body: JSON.stringify({ password: tempPassword }) });
      setTempPassword("");
      return `Password reset. ${fullName} is signed out everywhere and must choose a new password at next sign-in.`;
    });

  const removePermanently = () => {
    if (!window.confirm(`Permanently delete ${fullName} and all of their attendance, leave and salary records? This cannot be undone.`)) return;
    void run("delete", async () => {
      await api(`/api/employees/${employeeId}?permanent=1`, { method: "DELETE", body: JSON.stringify({ confirmName }) });
      return `${fullName} has been deleted.`;
    });
  };

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Admin controls</p>

      {role === "employee" && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-800">Promote to manager</p>
            <p className="text-xs text-slate-500">Keeps their departments, locations and history.</p>
          </div>
          <Button size="sm" variant="secondary" loading={busy === "promote"} disabled={!isActive || busy !== null} onClick={promote}>
            Promote
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">Reset password</p>
          <p className="text-xs text-slate-500">Set a temporary password. They are signed out everywhere and must choose their own.</p>
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            value={tempPassword}
            onChange={(e) => setTempPassword(e.target.value)}
            placeholder="Temporary password (8+ characters)"
            className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
          <Button size="sm" loading={busy === "password"} disabled={tempPassword.length < 8 || busy !== null} onClick={setTemporary}>
            Reset
          </Button>
        </div>
      </div>

      <div className="space-y-2 border-t border-slate-200 pt-4">
        <div>
          <p className="text-sm font-semibold text-rose-700">Delete permanently</p>
          <p className="text-xs text-slate-500">
            {isActive
              ? "Remove them first (deactivate). Only deactivated accounts can be deleted."
              : "Erases their attendance, leave and salary records. Type their full name to confirm."}
          </p>
        </div>
        {!isActive && (
          <div className="flex gap-2">
            <input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={fullName}
              className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
            />
            <Button size="sm" variant="danger" loading={busy === "delete"} disabled={confirmName.trim() !== fullName || busy !== null} onClick={removePermanently}>
              Delete
            </Button>
          </div>
        )}
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
    </div>
  );
}
