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

const LOGO_LIMIT_CHARS = 150_000;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file is not a valid image."));
    img.src = src;
  });
}

/**
 * Turns an uploaded picture into a small logo for the salary slips: resized to fit 240 px and encoded as PNG
 * (kept crisp when transparent), falling back to JPEG, and smaller sizes, until it is under the size limit.
 */
async function makeLogo(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Upload a PNG, JPEG or WebP image.");
  if (file.size > 5 * 1024 * 1024) throw new Error("That image is too large. Choose one under 5 MB.");
  const img = await loadImage(await readFileAsDataUrl(file));
  for (const side of [240, 200, 160, 120]) {
    const scale = Math.min(1, side / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) break;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL("image/png");
    if (png.length <= LOGO_LIMIT_CHARS) return png;
    const jpeg = canvas.toDataURL("image/jpeg", 0.85);
    if (jpeg.length <= LOGO_LIMIT_CHARS) return jpeg;
  }
  throw new Error("This logo is too detailed. Try a simpler or smaller image.");
}

/** Company name, details and logo. These appear at the top of every salary slip. */
function CompanyProfileCard({ initial, onSaved }: { initial: CompanyProfile; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<CompanyProfile>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => setForm(initial), [initial]);

  const patch = (p: Partial<CompanyProfile>) => setForm((f) => ({ ...f, ...p }));

  const onLogo = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    try {
      patch({ logoDataUrl: await makeLogo(file) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not use that image.");
    }
  };

  const save = async () => {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await api("/api/settings", { method: "POST", body: JSON.stringify({ company: form }) });
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

      <div className="mb-4 flex items-center gap-4 rounded-xl bg-slate-50 p-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
          {form.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.logoDataUrl} alt="Company logo" className="h-full w-full object-contain" />
          ) : (
            <span className="text-[10px] font-semibold text-slate-400">No logo</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer items-center rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-indigo-700 ring-1 ring-slate-300 hover:bg-slate-50">
            {form.logoDataUrl ? "Change logo" : "Upload logo"}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => void onLogo(e.target.files?.[0])} />
          </label>
          {form.logoDataUrl && (
            <button type="button" onClick={() => patch({ logoDataUrl: null })} className="rounded-xl px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50">
              Remove
            </button>
          )}
        </div>
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
      const data = await api<{ settings: Settings; holidays: Holiday[]; company: CompanyProfile | null }>("/api/settings");
      setSettings(data.settings);
      setHolidays(data.holidays ?? []);
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
      const { shiftStart, shiftEnd, timezone, annualLeaveDays, weeklyOff, approvalLevels } = settings;
      await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({ settings: { shiftStart, shiftEnd, timezone, annualLeaveDays, weeklyOff, approvalLevels } }),
      });
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
      <PageHeader title="Company Settings" subtitle="Company basics: working hours, calendar, holidays" />

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