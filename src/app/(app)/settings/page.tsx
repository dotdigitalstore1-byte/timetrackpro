"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, useMe } from "@/lib/client";
import { Button, Card, Input, PageHeader, Select, Spinner } from "@/components/ui";
import LogoEditor from "@/components/LogoEditor";

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

interface CompanyProfile {
  name: string;
  legalName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  taxId: string;
  logoDataUrl: string | null;
}

/** Company name, details and logo. These appear at the top of every salary slip. */
function CompanyProfileCard({ initial, onSaved }: { initial: CompanyProfile; onSaved: () => Promise<void> }) {
  const { me } = useMe();
  const logoVersion = me?.logoVersion ?? null;
  const [form, setForm] = useState<CompanyProfile>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => setForm(initial), [initial]);

  const patch = (p: Partial<CompanyProfile>) => setForm((f) => ({ ...f, ...p }));

  const save = async () => {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      // The logo is saved by LogoEditor, so this form sends only the text details.
      const { logoDataUrl: _logo, ...details } = form;
      void _logo;
      await api("/api/settings", { method: "POST", body: JSON.stringify({ company: details }) });
      setMessage("Company profile saved. New salary slips use these details.");
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <h3 className="mb-1 font-bold text-slate-900">Company profile &amp; salary slip branding</h3>
      <p className="mb-3 text-xs text-slate-500">These details and the logo are printed at the top of every salary slip.</p>

      <div className="mb-4">
        <LogoEditor version={logoVersion} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Company name (shown on slips)" value={form.name} onChange={(v) => patch({ name: v })} />
        <Input label="Legal name (optional)" value={form.legalName} onChange={(v) => patch({ legalName: v })} placeholder="Pvt. Ltd. name, if different" />
        <Input label="Address" value={form.address} onChange={(v) => patch({ address: v })} />
        <Input label="Phone" value={form.phone} onChange={(v) => patch({ phone: v })} />
        <Input label="Email" type="email" value={form.email} onChange={(v) => patch({ email: v })} />
        <Input label="Website" value={form.website} onChange={(v) => patch({ website: v })} placeholder="www.example.com" />
        <Input label="GSTIN / PAN / registration no." value={form.taxId} onChange={(v) => patch({ taxId: v })} />
      </div>

      {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
      {message && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{message}</p>}
      <Button className="mt-4" onClick={save} loading={saving} disabled={!form.name.trim()}>
        Save company profile
      </Button>
    </Card>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const data = await api<{ settings: Settings; company: CompanyProfile | null }>("/api/settings");
      setSettings(data.settings);
      setCompany(data.company ?? null);
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
    if (!settings) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      // Only this page's own fields: attendance rules and salary cycle are saved from the Rules page.
      const { shiftStart, shiftEnd, timezone, annualLeaveDays, approvalLevels } = settings;
      await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({ settings: { shiftStart, shiftEnd, timezone, annualLeaveDays, approvalLevels } }),
      });
      setMessage("Settings saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
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
      <PageHeader title="Company Settings" subtitle="Company basics: working hours, leave and company profile" />

      {message && <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{message}</p>}
      {error && <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-bold text-slate-900">Working hours &amp; calendar</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Default punch-in time" type="time" value={settings.shiftStart} onChange={(v) => set({ shiftStart: v })} />
            <Input label="Default punch-out time" type="time" value={settings.shiftEnd} onChange={(v) => set({ shiftEnd: v })} />
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Used for new employees and anyone without a personal shift. Each employee&apos;s own punch-in / punch-out time is set on the Employees page.
          </p>
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
          <p className="mt-3 rounded-xl bg-slate-50 px-3.5 py-3 text-xs leading-relaxed text-slate-600">
            Weekly off days and paid holidays are managed on the <Link href="/rules" className="font-semibold text-indigo-600 hover:underline">Rules page</Link>.
          </p>

          <h3 className="mb-2 mt-5 font-bold text-slate-900">General</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Leave approval levels"
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
          {company && <CompanyProfileCard initial={company} onSaved={load} />}

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
            <h3 className="mb-1 font-bold text-slate-900">Attendance &amp; payroll rules</h3>
            <p className="mb-3 text-sm text-slate-500">
              Cool-off time, late and early-leave rules, overtime, deductions and the salary cycle live on the Rules page.
            </p>
            <Link href="/rules"><Button variant="secondary" className="w-full">Open Rules</Button></Link>
          </Card>
        </div>
      </div>
    </div>
  );
}