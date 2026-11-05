"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { Button, Card, Input, PageHeader, Select, Spinner } from "@/components/ui";

interface Settings {
  shiftStart: string;
  shiftEnd: string;
  graceMinutes: number;
  lateThresholdMinutes: number;
  halfDayThresholdMinutes: number;
  lateDeductionType: string;
  lateDeductionValue: string;
  halfDayDeductionType: string;
  halfDayDeductionValue: string;
  leaveDeductionType: string;
  leaveDeductionValue: string;
  unapprovedHoldDays: number;
  workDaysPerMonth: number;
  currency: string;
  approvalLevels: number;
  timezone: string;
  weeklyOff: string;
  annualLeaveDays: number;
}

interface Holiday {
  id: string;
  holidayDate: string;
  name: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [hDate, setHDate] = useState("");
  const [hName, setHName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const data = await api<{ settings: Settings; holidays: Holiday[] }>("/api/settings");
      setSettings(data.settings);
      setHolidays(data.holidays ?? []);
    } catch (e) {
      setSettings(null);
      setLoadError(e instanceof Error ? e.message : "Could not load company settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveSettings = async () => {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await api("/api/settings", { method: "POST", body: JSON.stringify({ settings }) });
      setMessage("Settings saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const saveHoliday = async () => {
    setError("");
    try {
      await api("/api/settings", { method: "POST", body: JSON.stringify({ holiday: { date: hDate, name: hName } }) });
      setHDate("");
      setHName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save holiday");
    }
  };

  const deleteHoliday = async (id: string) => {
    await api("/api/settings", { method: "POST", body: JSON.stringify({ deleteHolidayId: id }) });
    await load();
  };

  const set = (patch: Partial<Settings>) => setSettings((s) => (s ? { ...s, ...patch } : s));

  if (loading && !settings) {
    return <div className="flex justify-center py-16"><Spinner /></div>;
  }

  if (!settings) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <p className="text-sm font-medium text-rose-600">{loadError || "Company settings are not available."}</p>
        <Button className="mt-3" variant="secondary" size="sm" onClick={load}>Try again</Button>
      </Card>
    );
  }

  return (
    <div>
      <PageHeader title="Company Settings" subtitle="Attendance rules, salary & deduction policies, holidays" />

      {message && <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{message}</p>}
      {error && <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-bold text-slate-900">Attendance Rules</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Shift start (HH:MM)" value={settings.shiftStart} onChange={(v) => set({ shiftStart: v })} />
            <Input label="Shift end (HH:MM)" value={settings.shiftEnd} onChange={(v) => set({ shiftEnd: v })} />
            <Input label="Grace period (minutes)" type="number" value={settings.graceMinutes} onChange={(v) => set({ graceMinutes: Number(v) })} />
            <Input label="Late threshold (minutes)" type="number" value={settings.lateThresholdMinutes} onChange={(v) => set({ lateThresholdMinutes: Number(v) })} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Timezone (IANA)</span>
              <input
                list="tz-list"
                value={settings.timezone}
                onChange={(e) => set({ timezone: e.target.value })}
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500"
                placeholder="Asia/Kolkata"
              />
              <datalist id="tz-list">
                {(typeof Intl !== "undefined" && "supportedValuesOf" in Intl
                  ? (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone")
                  : []
                ).map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </label>
            <Input label="Annual leave days per employee" type="number" value={settings.annualLeaveDays} onChange={(v) => set({ annualLeaveDays: Number(v) })} />
          </div>
          <div className="mt-3">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Weekly off days</span>
            <div className="flex flex-wrap gap-2">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => {
                const off = settings.weeklyOff.split(",").map(Number).includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      const cur = new Set(settings.weeklyOff.split(",").filter(Boolean).map(Number));
                      if (off) cur.delete(i); else cur.add(i);
                      set({ weeklyOff: [...cur].sort().join(",") });
                    }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold ${off ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">Highlighted days are weekly offs. Absences are never counted on weekly offs or holidays.</p>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Arrival within grace = present · within late threshold = late · beyond threshold = half-day.</p>

          <h3 className="mb-2 mt-5 font-bold text-slate-900">Late / Half-Day Deductions</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Late deduction type"
              value={settings.lateDeductionType}
              onChange={(v) => set({ lateDeductionType: v })}
              options={[
                { value: "percentage", label: "% of daily rate" },
                { value: "fixed", label: "Fixed amount" },
              ]}
            />
            <Input label="Late deduction value" type="number" value={settings.lateDeductionValue} onChange={(v) => set({ lateDeductionValue: v })} />
            <Select
              label="Half-day deduction type"
              value={settings.halfDayDeductionType}
              onChange={(v) => set({ halfDayDeductionType: v })}
              options={[
                { value: "percentage", label: "% of daily rate" },
                { value: "fixed", label: "Fixed amount" },
              ]}
            />
            <Input label="Half-day deduction value" type="number" value={settings.halfDayDeductionValue} onChange={(v) => set({ halfDayDeductionValue: v })} />
          </div>

          <h3 className="mb-2 mt-5 font-bold text-slate-900">Leave & Salary Policy</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Approved leave deduction type"
              value={settings.leaveDeductionType}
              onChange={(v) => set({ leaveDeductionType: v })}
              options={[
                { value: "percentage", label: "% of daily rate" },
                { value: "fixed", label: "Fixed amount" },
              ]}
            />
            <Input label="Leave deduction value" type="number" value={settings.leaveDeductionValue} onChange={(v) => set({ leaveDeductionValue: v })} />
            <Input label="Unapproved leave hold (days/occurrence)" type="number" value={settings.unapprovedHoldDays} onChange={(v) => set({ unapprovedHoldDays: Number(v) })} />
            <Input label="Work days per month" type="number" value={settings.workDaysPerMonth} onChange={(v) => set({ workDaysPerMonth: Number(v) })} />
            <Input label="Currency symbol" value={settings.currency} onChange={(v) => set({ currency: v })} />
            <Select
              label="Approval levels"
              value={String(settings.approvalLevels)}
              onChange={(v) => set({ approvalLevels: Number(v) })}
              options={[
                { value: "1", label: "1 level (admin only)" },
                { value: "2", label: "2 levels (manager → admin)" },
              ]}
            />
          </div>

          <Button className="mt-4" onClick={saveSettings} loading={saving}>Save Settings</Button>
        </Card>

        <div className="space-y-4">
          <Card>
            <h3 className="mb-3 font-bold text-slate-900">Company Holidays</h3>
            {holidays.length === 0 ? (
              <p className="mb-3 text-sm text-slate-400">No holidays added.</p>
            ) : (
              <div className="mb-3 space-y-2">
                {holidays.map((h) => (
                  <div key={h.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                    <p className="text-sm text-slate-700"><span className="font-bold">{h.holidayDate.slice(0, 10)}</span> · {h.name}</p>
                    <button onClick={() => deleteHoliday(h.id)} className="text-xs font-semibold text-rose-500 hover:underline">Delete</button>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3">
              <Input label="Date" type="date" value={hDate} onChange={setHDate} />
              <Input label="Name" value={hName} onChange={setHName} placeholder="e.g. Diwali" />
              <Button className="col-span-2" size="sm" onClick={saveHoliday} disabled={!hDate || !hName.trim()}>Add holiday</Button>
            </div>
          </Card>

          <Card>
            <h3 className="mb-1 font-bold text-slate-900">Departments &amp; work locations</h3>
            <p className="mb-3 text-sm text-slate-500">
              Manage your departments and the work locations (with GPS punch radius) on their own pages.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/departments"><Button variant="secondary" className="w-full">Departments</Button></Link>
              <Link href="/locations"><Button variant="secondary" className="w-full">Locations</Button></Link>
            </div>
          </Card>

          <Card>
            <h3 className="mb-2 font-bold text-slate-900">How salary is calculated</h3>
            <ul className="list-inside list-disc space-y-1 text-xs text-slate-500">
              <li>Daily rate = basic salary ÷ work days per month ({settings.workDaysPerMonth})</li>
              <li>Attendance salary = daily rate × present days (half-day counts as 0.5)</li>
              <li>Late, half-day and approved-leave deductions apply per policy above</li>
              <li>Each unapproved leave occurrence adds a {settings.unapprovedHoldDays}-day salary hold</li>
              <li>Net payable = attendance salary − all deductions − holds</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}