"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, Modal, PageHeader, Select, Spinner } from "@/components/ui";
import { formatMoney } from "@/lib/utils";

interface Settings {
  baseFee: number;
  defaultCommissionPercent: number;
}
interface Tier {
  id?: string;
  maxEmployees: number | null;
  pricePerEmployee: number;
}
interface SpecialistRow {
  userId: string;
  fullName: string;
  email: string;
  phone: string;
  photoDataUrl: string | null;
  isActive: boolean;
  commissionOverride: number | null;
  effectiveCommission: number;
  activeClaims: number;
  completed: number;
  averageSatisfaction: number | null;
  commissionThisMonth: number;
}
interface MonitorRow {
  id: string;
  status: string;
  companyName: string;
  specialistName: string | null;
  total: number;
  includeOnboarding: boolean;
  includeEmployees: boolean;
  employeeCount: number;
  paidAt: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  releaseCount: number;
  flagReason: string | null;
  delayed: boolean;
  ratingStage: "waiting" | "reminder" | "auto_complete" | null;
  satisfaction: number | null;
  ratingSource: string | null;
  commissionAmount: number | null;
}
interface Payout {
  specialistId: string;
  name: string;
  email: string;
  completed: number;
  rated: number;
  averageSatisfaction: number | null;
  commission: number;
  belowBenchmark: boolean;
}
interface OnboardingAdmin {
  settings: Settings;
  tiers: Tier[];
  specialists: SpecialistRow[];
  monitor: { rows: MonitorRow[]; counts: Record<string, number>; released: number; flagged: number; delayed: number };
  payouts: Payout[];
  month: string;
}

const STATUS_TONE: Record<string, "amber" | "indigo" | "sky" | "green" | "slate"> = {
  open: "amber",
  claimed: "indigo",
  awaiting_rating: "sky",
  completed: "green",
};

/** Reads an image, scales it so its longest side is 256px, and returns a small JPEG data URL. */
async function photoToDataUrl(file: File): Promise<string> {
  if (!/^image\//.test(file.type)) throw new Error("Choose an image file.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process the photo.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

const currentMonth = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export default function SuperAdminOnboardingPage() {
  const [data, setData] = useState<OnboardingAdmin | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [month, setMonth] = useState(currentMonth());
  const [statusFilter, setStatusFilter] = useState("all");

  // Pricing form (kept separately so edits do not change the live numbers until saved)
  const [baseFee, setBaseFee] = useState("");
  const [commission, setCommission] = useState("");
  const [slabs, setSlabs] = useState<{ max: string; price: string }[]>([]);
  const [savingPricing, setSavingPricing] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newSpec, setNewSpec] = useState({ fullName: "", email: "", password: "", phone: "", commission: "", photo: "" });
  const [editing, setEditing] = useState<SpecialistRow | null>(null);
  const [editForm, setEditForm] = useState({ commission: "", phone: "", active: true, password: "", photo: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (m = month) => {
      setLoading(true);
      setError("");
      try {
        const d = await api<OnboardingAdmin>(`/api/superadmin/onboarding?month=${m}`);
        setData(d);
        setBaseFee(String(d.settings.baseFee));
        setCommission(String(d.settings.defaultCommissionPercent));
        setSlabs(d.tiers.map((t) => ({ max: t.maxEmployees === null ? "" : String(t.maxEmployees), price: String(t.pricePerEmployee) })));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load Expert Onboarding");
      } finally {
        setLoading(false);
      }
    },
    [month]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const savePricing = async () => {
    setSavingPricing(true);
    setError("");
    setNotice("");
    try {
      const tiers = slabs.map((s) => ({
        maxEmployees: s.max.trim() === "" ? null : Number(s.max),
        pricePerEmployee: Number(s.price),
      }));
      await api("/api/superadmin/onboarding", {
        method: "PUT",
        body: JSON.stringify({ settings: { baseFee: Number(baseFee), defaultCommissionPercent: Number(commission) }, tiers }),
      });
      setNotice("Pricing saved. New requests use these prices straight away.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the pricing");
    } finally {
      setSavingPricing(false);
    }
  };

  const createSpecialist = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/api/superadmin/onboarding/specialists", {
        method: "POST",
        body: JSON.stringify({
          fullName: newSpec.fullName,
          email: newSpec.email,
          password: newSpec.password,
          phone: newSpec.phone,
          photoDataUrl: newSpec.photo || null,
          commissionPercent: newSpec.commission.trim() === "" ? null : Number(newSpec.commission),
        }),
      });
      setCreating(false);
      setNewSpec({ fullName: "", email: "", password: "", phone: "", commission: "", photo: "" });
      setNotice("Specialist created. They can sign in with the email and password you set.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the specialist");
    } finally {
      setBusy(false);
    }
  };

  const saveSpecialist = async () => {
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/superadmin/onboarding/specialists/${editing.userId}`, {
        method: "PATCH",
        body: JSON.stringify({
          commissionPercent: editForm.commission.trim() === "" ? null : Number(editForm.commission),
          phone: editForm.phone,
          isActive: editForm.active,
          ...(editForm.password ? { password: editForm.password } : {}),
          ...(editForm.photo ? { photoDataUrl: editForm.photo } : {}),
        }),
      });
      setEditing(null);
      setNotice("Specialist updated.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the specialist");
    } finally {
      setBusy(false);
    }
  };

  const monitorRows = (data?.monitor.rows ?? []).filter((r) => statusFilter === "all" || r.status === statusFilter);

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-10">
      <PageHeader title="Expert Onboarding" subtitle="Prices, specialists, live request monitoring and monthly payouts." />

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}
      {notice && <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{notice}</p>}
      {loading && !data && <div className="flex justify-center py-12"><Spinner /></div>}

      {data && (
        <>
          {/* ---- Pricing */}
          <section className="grid gap-6 lg:grid-cols-2">
            <Card className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Pricing</h2>
                <p className="text-xs text-slate-500">Changes apply to new requests only.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Onboarding base fee (₹)" type="number" min="0" value={baseFee} onChange={setBaseFee} />
                <Input label="Default specialist commission (%)" type="number" min="0" max="100" value={commission} onChange={setCommission} />
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-800">Employee slabs (₹ per employee)</p>
                <p className="text-xs text-slate-500">Each slab covers headcounts up to its threshold. Leave the threshold blank for the open-ended last slab.</p>
                {slabs.map((s, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                    <Input label={i === 0 ? "Up to (employees)" : undefined} type="number" min="1" value={s.max} onChange={(v) => setSlabs(slabs.map((x, j) => (j === i ? { ...x, max: v } : x)))} placeholder="(above last)" />
                    <Input label={i === 0 ? "Price per employee" : undefined} type="number" min="1" value={s.price} onChange={(v) => setSlabs(slabs.map((x, j) => (j === i ? { ...x, price: v } : x)))} />
                    <Button variant="ghost" size="sm" onClick={() => setSlabs(slabs.filter((_, j) => j !== i))} aria-label="Remove slab">✕</Button>
                  </div>
                ))}
                <Button variant="secondary" size="sm" onClick={() => setSlabs([...slabs, { max: "", price: "" }])}>
                  Add slab
                </Button>
              </div>
              <Button onClick={() => void savePricing()} loading={savingPricing} className="w-full">
                Save pricing
              </Button>
            </Card>

            {/* ---- Monitoring summary */}
            <Card className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Request monitoring</h2>
                <p className="text-xs text-slate-500">Every paid request, with flags, delays and satisfaction.</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Open" value={data.monitor.counts.open ?? 0} />
                <Stat label="In progress" value={data.monitor.counts.claimed ?? 0} />
                <Stat label="Awaiting rating" value={data.monitor.counts.awaiting_rating ?? 0} />
                <Stat label="Completed" value={data.monitor.counts.completed ?? 0} />
                <Stat label="Released (total)" value={data.monitor.released} />
                <Stat label="Flagged" value={data.monitor.flagged} tone="amber" />
                <Stat label="Delayed (48h+)" value={data.monitor.delayed} tone="red" />
              </div>
            </Card>
          </section>

          {/* ---- Specialists */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-900">Onboarding specialists</h2>
              <Button onClick={() => setCreating(true)}>Add specialist</Button>
            </div>
            <p className="text-xs text-slate-500">
              Default commission: {data.settings.defaultCommissionPercent}%. A per-specialist override takes precedence; clear it to use the default.
            </p>
            {data.specialists.length === 0 && <EmptyState message="No specialists yet. Add one to start taking requests." />}
            <div className="grid gap-3 md:grid-cols-2">
              {data.specialists.map((s) => (
                <Card key={s.userId} className="space-y-3">
                  <div className="flex items-center gap-3">
                    {s.photoDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.photoDataUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 font-bold text-indigo-700">{s.fullName.slice(0, 1).toUpperCase()}</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900">{s.fullName}</p>
                      <p className="truncate text-xs text-slate-500">{s.email} · {s.phone || "no phone"}</p>
                    </div>
                    {s.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="red">Inactive</Badge>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <Mini label="Commission" value={`${s.effectiveCommission}%${s.commissionOverride === null ? " (default)" : ""}`} />
                    <Mini label="In hand" value={String(s.activeClaims)} />
                    <Mini label="Completed" value={String(s.completed)} />
                    <Mini label="Satisfaction" value={s.averageSatisfaction === null ? "—" : `${s.averageSatisfaction}%`} />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-500">This month: <span className="font-semibold text-slate-800">{formatMoney(s.commissionThisMonth, 2)}</span></p>
                    <Button variant="secondary" size="sm" onClick={() => {
                      setEditing(s);
                      setEditForm({ commission: s.commissionOverride === null ? "" : String(s.commissionOverride), phone: s.phone, active: s.isActive, password: "", photo: "" });
                    }}>
                      Edit
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </section>

          {/* ---- Monthly payouts */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">Monthly earnings split</h2>
                <p className="text-xs text-slate-500">Completed requests per specialist, for salary and payout.</p>
              </div>
              <div className="w-44">
                <Input label="Month" type="month" value={month} onChange={(v) => { setMonth(v); void load(v); }} />
              </div>
            </div>
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Specialist</th>
                    <th className="px-4 py-3">Completed</th>
                    <th className="px-4 py-3">Rated</th>
                    <th className="px-4 py-3">Avg satisfaction</th>
                    <th className="px-4 py-3 text-right">Commission</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.payouts.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No completed requests in {data.month}.</td></tr>
                  )}
                  {data.payouts.map((p) => (
                    <tr key={p.specialistId}>
                      <td className="px-4 py-3"><p className="font-semibold text-slate-900">{p.name}</p><p className="text-xs text-slate-500">{p.email}</p></td>
                      <td className="px-4 py-3">{p.completed}</td>
                      <td className="px-4 py-3">{p.rated}</td>
                      <td className="px-4 py-3">
                        {p.averageSatisfaction === null ? "—" : (
                          <span className="flex items-center gap-2">
                            {p.averageSatisfaction}%
                            {p.belowBenchmark ? <Badge tone="red">Below 60%</Badge> : <Badge tone="green">Meets 60%</Badge>}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">{formatMoney(p.commission, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>

          {/* ---- Request log */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 className="text-base font-bold text-slate-900">All requests</h2>
              <div className="w-56">
                <Select
                  label="Status"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { value: "all", label: "All statuses" },
                    { value: "open", label: "Open" },
                    { value: "claimed", label: "In progress" },
                    { value: "awaiting_rating", label: "Awaiting rating" },
                    { value: "completed", label: "Completed" },
                  ]}
                />
              </div>
            </div>
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Company</th>
                    <th className="px-4 py-3">Service</th>
                    <th className="px-4 py-3">Paid</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Specialist</th>
                    <th className="px-4 py-3">Satisfaction</th>
                    <th className="px-4 py-3">Flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {monitorRows.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No requests match this filter.</td></tr>
                  )}
                  {monitorRows.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="px-4 py-3 font-semibold text-slate-900">{r.companyName}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {[r.includeOnboarding && "Onboarding", r.includeEmployees && `${r.employeeCount} employees`].filter(Boolean).join(" + ")}
                      </td>
                      <td className="px-4 py-3">{formatMoney(r.total, 2)}</td>
                      <td className="px-4 py-3"><Badge tone={STATUS_TONE[r.status] ?? "slate"}>{r.status.replace("_", " ")}</Badge></td>
                      <td className="px-4 py-3">{r.specialistName ?? <span className="text-slate-400">unassigned</span>}</td>
                      <td className="px-4 py-3">
                        {r.satisfaction === null ? (
                          r.ratingStage === "reminder" ? <Badge tone="amber">Reminder sent</Badge> : <span className="text-slate-400">—</span>
                        ) : (
                          <span>{r.satisfaction}% {r.ratingSource === "auto" && <span className="text-xs text-slate-500">(auto)</span>}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 space-y-1">
                        {r.delayed && <Badge tone="red">Delayed</Badge>}
                        {r.flagReason && <p className="max-w-xs text-xs text-amber-800">⚑ {r.flagReason}</p>}
                        {r.releaseCount > 0 && <p className="text-xs text-slate-500">Released {r.releaseCount}×</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>
        </>
      )}

      {/* ---- Create specialist */}
      <Modal open={creating} onClose={() => setCreating(false)} title="Add onboarding specialist">
        <div className="space-y-3">
          <Input label="Full name" value={newSpec.fullName} onChange={(v) => setNewSpec({ ...newSpec, fullName: v })} required />
          <Input label="Email ID (sign-in)" type="email" value={newSpec.email} onChange={(v) => setNewSpec({ ...newSpec, email: v })} required />
          <Input label="Password (min 8 characters)" type="password" value={newSpec.password} onChange={(v) => setNewSpec({ ...newSpec, password: v })} required />
          <Input label="Phone number" type="tel" value={newSpec.phone} onChange={(v) => setNewSpec({ ...newSpec, phone: v })} required />
          <Input label="Commission override (%, blank = default)" type="number" min="0" max="100" value={newSpec.commission} onChange={(v) => setNewSpec({ ...newSpec, commission: v })} />
          <PhotoField value={newSpec.photo} onChange={(photo) => setNewSpec({ ...newSpec, photo })} />
          <Button className="w-full" loading={busy} onClick={() => void createSpecialist()}>Create specialist</Button>
        </div>
      </Modal>

      {/* ---- Edit specialist */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `Edit ${editing.fullName}` : "Edit specialist"}>
        <div className="space-y-3">
          <Input label="Commission override (%, blank = default)" type="number" min="0" max="100" value={editForm.commission} onChange={(v) => setEditForm({ ...editForm, commission: v })} />
          <Input label="Phone number" type="tel" value={editForm.phone} onChange={(v) => setEditForm({ ...editForm, phone: v })} />
          <Input label="New password (leave blank to keep)" type="password" value={editForm.password} onChange={(v) => setEditForm({ ...editForm, password: v })} />
          <PhotoField value={editForm.photo} onChange={(photo) => setEditForm({ ...editForm, photo })} />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={editForm.active} onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
            Active (deactivating returns their open work to the queue)
          </label>
          <Button className="w-full" loading={busy} onClick={() => void saveSpecialist()}>Save changes</Button>
        </div>
      </Modal>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "amber" | "red" }) {
  const color = tone === "red" ? "text-rose-700" : tone === "amber" ? "text-amber-700" : "text-slate-900";
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
      <p className="text-[10px] font-semibold uppercase text-slate-500">{label}</p>
      <p className="font-semibold text-slate-800">{value}</p>
    </div>
  );
}

function PhotoField({ value, onChange }: { value: string; onChange: (dataUrl: string) => void }) {
  const [err, setErr] = useState("");
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-slate-700">
        Profile photo (optional)
        <input
          type="file"
          accept="image/*"
          className="mt-1 block w-full text-sm"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              setErr("");
              onChange(await photoToDataUrl(file));
            } catch (ex) {
              setErr(ex instanceof Error ? ex.message : "Could not read the photo");
            }
          }}
        />
      </label>
      {value && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="Preview" className="h-16 w-16 rounded-full object-cover" />
      )}
      {err && <p className="text-xs text-rose-600">{err}</p>}
    </div>
  );
}
