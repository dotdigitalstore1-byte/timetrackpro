"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Textarea } from "@/components/ui";
import { PLATFORM_FEATURES } from "@/lib/billing-core";

interface PlanRow {
  id: string;
  name: string;
  employeeLimit: number;
  price: number;
  compareAtPrice: number | null;
  features: string[];
  isActive: boolean;
  sortOrder: number;
  activeSubscriptions: number;
}

interface CycleRow {
  id: string;
  months: number;
  label: string;
  discountPercent: number;
  isActive: boolean;
}

interface PlanForm {
  id: string | null;
  name: string;
  employeeLimit: string;
  price: string;
  compareAtPrice: string;
  features: string;
  isActive: string;
  sortOrder: string;
}

const emptyForm: PlanForm = {
  id: null,
  name: "",
  employeeLimit: "",
  price: "",
  compareAtPrice: "",
  features: PLATFORM_FEATURES.join("\n"),
  isActive: "true",
  sortOrder: "0",
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function SuperAdminPlansPage() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState<PlanForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingCycles, setSavingCycles] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const data = await api<{ plans: PlanRow[]; cycles: CycleRow[] }>("/api/superadmin/plans");
      setPlans(data.plans);
      setCycles(data.cycles);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load plans");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = () => {
    setError("");
    setForm({ ...emptyForm, sortOrder: String((plans.at(-1)?.sortOrder ?? 0) + 1) });
  };

  const openEdit = (p: PlanRow) => {
    setError("");
    setForm({
      id: p.id,
      name: p.name,
      employeeLimit: String(p.employeeLimit),
      price: String(p.price),
      compareAtPrice: p.compareAtPrice === null ? "" : String(p.compareAtPrice),
      features: p.features.join("\n"),
      isActive: String(p.isActive),
      sortOrder: String(p.sortOrder),
    });
  };

  const savePlan = async () => {
    if (!form) return;
    setSaving(true);
    setError("");
    try {
      await api("/api/superadmin/plans", {
        method: "POST",
        body: JSON.stringify({
          action: form.id ? "update" : "create",
          id: form.id,
          name: form.name,
          employeeLimit: form.employeeLimit,
          price: form.price,
          compareAtPrice: form.compareAtPrice,
          features: form.features,
          isActive: form.isActive === "true",
          sortOrder: form.sortOrder,
        }),
      });
      setNotice(form.id ? "Plan saved. New purchases use the new price; existing subscriptions keep what they paid." : "Plan created.");
      setForm(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the plan");
    } finally {
      setSaving(false);
    }
  };

  const removePlan = async (p: PlanRow) => {
    if (!window.confirm(`Delete the ${p.name} plan? This cannot be undone.`)) return;
    setDeleting(p.id);
    setError("");
    try {
      await api("/api/superadmin/plans", { method: "POST", body: JSON.stringify({ action: "delete", id: p.id }) });
      setNotice(`${p.name} deleted.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the plan");
    } finally {
      setDeleting(null);
    }
  };

  const updateCycle = (months: number, patch: Partial<CycleRow>) =>
    setCycles((list) => list.map((c) => (c.months === months ? { ...c, ...patch } : c)));

  const saveCycles = async () => {
    setSavingCycles(true);
    setError("");
    try {
      await api("/api/superadmin/plans", {
        method: "POST",
        body: JSON.stringify({
          action: "saveCycles",
          cycles: cycles.map((c) => ({ months: c.months, label: c.label, discountPercent: c.discountPercent, isActive: c.isActive })),
        }),
      });
      setNotice("Billing lengths saved.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save billing lengths");
    } finally {
      setSavingCycles(false);
    }
  };

  const previewPrice = form && Number(form.price) > 0 ? Number(form.price) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plans & pricing"
        subtitle="Create and edit the seat tiers shown on the landing page and checkout. Every plan includes every feature."
        action={<Button onClick={openNew}>New plan</Button>}
      />

      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="text-emerald-700 hover:underline">Dismiss</button>
        </div>
      )}
      {loadError && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{loadError}</p>}
      {error && !form && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-3 text-slate-500"><Spinner /> Loading plans…</div>
      ) : plans.length === 0 ? (
        <EmptyState message="No plans yet. Create the first one." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Plan</th>
                  <th className="px-4 py-3 font-semibold">Seats</th>
                  <th className="px-4 py-3 font-semibold">Price / month</th>
                  <th className="px-4 py-3 font-semibold">Compare at</th>
                  <th className="px-4 py-3 font-semibold">Subscribers</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plans.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-semibold text-slate-900">{p.name}</td>
                    <td className="px-4 py-3 text-slate-700">{p.employeeLimit}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{inr(p.price)}</td>
                    <td className="px-4 py-3 text-slate-400">{p.compareAtPrice === null ? "—" : <s>{inr(p.compareAtPrice)}</s>}</td>
                    <td className="px-4 py-3 text-slate-700">{p.activeSubscriptions}</td>
                    <td className="px-4 py-3">{p.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Hidden</Badge>}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => openEdit(p)}>Edit</Button>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={deleting === p.id}
                          disabled={p.activeSubscriptions > 0 || deleting !== null}
                          onClick={() => removePlan(p)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {plans.some((p) => p.activeSubscriptions > 0) && (
        <p className="text-xs text-slate-500">
          Plans that companies are using cannot be deleted. Hide them instead by editing the plan and setting its status to Hidden.
        </p>
      )}

      <Card className="p-5">
        <h2 className="text-base font-bold text-slate-900">Billing lengths</h2>
        <p className="mt-1 text-xs text-slate-500">
          The discount applies to the whole period. A 6-month plan at 10% off costs 6 × monthly price × 0.9, rounded to whole rupees.
        </p>
        {cycles.length > 0 && (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {cycles.map((c) => (
              <div key={c.months} className="space-y-3 rounded-xl border border-slate-200 p-4">
                <p className="text-sm font-bold text-slate-800">{c.months} {c.months === 1 ? "month" : "months"}</p>
                <Input label="Label" value={c.label} onChange={(v) => updateCycle(c.months, { label: v })} />
                <Input
                  label="Discount (%)"
                  type="number"
                  value={c.discountPercent}
                  onChange={(v) => updateCycle(c.months, { discountPercent: Number(v) || 0 })}
                  min="0"
                  max="90"
                  step="0.5"
                />
                <Select
                  label="Offered at checkout"
                  value={String(c.isActive)}
                  onChange={(v) => updateCycle(c.months, { isActive: v === "true" })}
                  options={[
                    { value: "true", label: "Yes" },
                    { value: "false", label: "No" },
                  ]}
                />
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <Button onClick={saveCycles} loading={savingCycles}>Save billing lengths</Button>
        </div>
      </Card>

      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.id ? `Edit ${form.name}` : "New plan"}>
        {form && (
          <div className="space-y-3">
            <Input label="Plan name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Team 10" />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Employee limit (seats)" type="number" min="1" value={form.employeeLimit} onChange={(v) => setForm({ ...form, employeeLimit: v })} />
              <Input label="Sort order" type="number" value={form.sortOrder} onChange={(v) => setForm({ ...form, sortOrder: v })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Active price (₹ / month)" type="number" min="1" step="1" value={form.price} onChange={(v) => setForm({ ...form, price: v })} />
              <Input
                label="Compare at (₹ / month)"
                type="number"
                min="1"
                step="1"
                value={form.compareAtPrice}
                onChange={(v) => setForm({ ...form, compareAtPrice: v })}
                placeholder="Leave empty for none"
              />
            </div>
            {form.compareAtPrice !== "" && previewPrice !== null && Number(form.compareAtPrice) > previewPrice && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                Shown as <s>{inr(Number(form.compareAtPrice))}</s> → <span className="font-bold">{inr(previewPrice)}</span> per month on the storefront.
              </p>
            )}
            <Textarea label="Features (one per line)" value={form.features} onChange={(v) => setForm({ ...form, features: v })} rows={7} />
            <Select
              label="Status"
              value={form.isActive}
              onChange={(v) => setForm({ ...form, isActive: v })}
              options={[
                { value: "true", label: "Active (visible and purchasable)" },
                { value: "false", label: "Hidden (existing subscribers keep it)" },
              ]}
            />
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
            <Button className="w-full" loading={saving} onClick={savePlan}>
              {form.id ? "Save plan" : "Create plan"}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
