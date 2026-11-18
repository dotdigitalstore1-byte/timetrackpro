"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { Badge, Button, Card, Input, Modal, PageHeader, Select, Spinner, StatCard } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/utils";
import { normalizeCompanyCode } from "@/lib/company-code-core";
import { DEFAULT_GRACE_POLICY, type GracePolicy } from "@/lib/billing-core";

interface CompanyRow {
  id: string;
  code: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  subscriptionPlan: string;
  subscriptionStatus: string;
  accessUntil: string | null;
  employeeLimit: number | null;
  employeeCount: number;
  subscription: { plan: string; amount: string; status: string; endDate: string | null } | null;
  createdAt: string;
}

interface Stats {
  totalCompanies: number;
  activeCompanies: number;
  totalEmployees: number;
  presentCompaniesToday: number;
}

function accessSummary(c: CompanyRow): string {
  if (!c.accessUntil) return "No expiry";
  const trial = c.subscriptionStatus === "trial";
  const expired = new Date(c.accessUntil).getTime() <= Date.now();
  if (expired) return trial ? "Trial ended" : "Subscription ended";
  return trial ? "Trial" : c.subscriptionPlan;
}

function accessDetail(c: CompanyRow): string {
  const seats = c.employeeLimit === null ? "unlimited seats" : `${c.employeeLimit} seats`;
  if (!c.accessUntil) return `Legacy account · ${seats}`;
  return `until ${formatDate(c.accessUntil)} · ${seats}`;
}

export default function SuperAdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editCompany, setEditCompany] = useState<CompanyRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [deleteName, setDeleteName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [notice, setNotice] = useState("");
  const [grace, setGrace] = useState<GracePolicy | null>(null);
  const [graceDraft, setGraceDraft] = useState({ blurAfterDays: "", punchUntilDays: "", blockAfterDays: "" });
  const [graceSaving, setGraceSaving] = useState(false);
  const [graceError, setGraceError] = useState("");

  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [plans, setPlans] = useState<{ id: string; name: string; employeeLimit: number }[]>([]);
  const [grantPlanId, setGrantPlanId] = useState("");
  const [grantMonths, setGrantMonths] = useState(1);
  const [granting, setGranting] = useState(false);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const data = await api<{ stats: Stats; companies: CompanyRow[]; gracePolicy: GracePolicy }>("/api/superadmin");
      setStats(data.stats);
      setCompanies(data.companies);
      setGrace(data.gracePolicy);
      setGraceDraft({
        blurAfterDays: String(data.gracePolicy.blurAfterDays),
        punchUntilDays: String(data.gracePolicy.punchUntilDays),
        blockAfterDays: String(data.gracePolicy.blockAfterDays),
      });
    } catch (e) {
      setCompanies([]);
      setLoadError(e instanceof Error ? e.message : "Could not load platform data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    api<{ plans: { id: string; name: string; employeeLimit: number }[] }>("/api/superadmin/plans")
      .then((d) => setPlans(d.plans))
      .catch(() => setPlans([]));
  }, [load]);

  const grantPlan = async (companyId: string) => {
    setGranting(true);
    setError("");
    try {
      await api("/api/superadmin", {
        method: "POST",
        body: JSON.stringify({ action: "grantSubscription", companyId, planId: grantPlanId, months: grantMonths }),
      });
      setNotice("Subscription granted. The company's access has been updated.");
      setGrantPlanId("");
      setEditCompany(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not grant the subscription");
    } finally {
      setGranting(false);
    }
  };

  const createCompany = async () => {
    setSaving(true);
    setError("");
    try {
      await api("/api/superadmin", { method: "POST", body: JSON.stringify({ action: "createCompany", ...form }) });
      setCreateOpen(false);
      setForm({ name: "", email: "", password: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Creation failed");
    } finally {
      setSaving(false);
    }
  };

  const updateCompany = async (companyId: string, patch: { status?: string }) => {
    await api("/api/superadmin", { method: "POST", body: JSON.stringify({ action: "updateCompany", companyId, ...patch }) });
    setEditCompany(null);
    await load();
  };

  const closeManage = () => {
    setEditCompany(null);
    setDeleteName("");
    setDeleteError("");
  };

  /** Permanently removes a company and everything that belongs to it. The server re-checks the typed name. */
  const deleteCompany = async (company: CompanyRow) => {
    setDeleting(true);
    setDeleteError("");
    try {
      await api("/api/superadmin", {
        method: "POST",
        body: JSON.stringify({ action: "deleteCompany", companyId: company.id, confirmName: deleteName }),
      });
      setNotice(`${company.name} and all of its data were deleted. The deletion is recorded in the platform log.`);
      closeManage();
      await load();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Could not delete the company");
    } finally {
      setDeleting(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    // A typed company code ("co 7k3d9pmq") matches exactly, whatever the spacing or case.
    const code = normalizeCompanyCode(search);
    if (code) return companies.filter((c) => c.code === code);
    return companies.filter((c) =>
      [c.name, c.email, c.code, c.subscriptionPlan, c.status].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [companies, search]);

  const saveGrace = async () => {
    setGraceSaving(true);
    setGraceError("");
    try {
      const data = await api<{ gracePolicy: GracePolicy }>("/api/superadmin", {
        method: "POST",
        body: JSON.stringify({ action: "updateGracePolicy", ...graceDraft }),
      });
      setGrace(data.gracePolicy);
      setNotice("Grace periods saved. The new limits apply to every company within about a minute.");
    } catch (e) {
      setGraceError(e instanceof Error ? e.message : "Could not save the grace periods");
    } finally {
      setGraceSaving(false);
    }
  };


  return (
    <div>
      <PageHeader
        title="Platform Administration"
        subtitle="Manage all companies, subscriptions and platform health"
        action={<Button size="sm" onClick={() => setCreateOpen(true)}>+ Create Company</Button>}
      />

      {notice && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="text-emerald-700 hover:underline">Dismiss</button>
        </div>
      )}

      {loading && !stats ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : !stats ? (
        <Card>
          <p className="text-center text-sm font-medium text-rose-600">{loadError || "Platform data is not available."}</p>
          <div className="mt-3 flex justify-center">
            <Button size="sm" variant="secondary" onClick={load}>Try again</Button>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Companies" value={stats.totalCompanies} tone="indigo" />
            <StatCard label="Active Companies" value={stats.activeCompanies} tone="emerald" />
            <StatCard label="Total Employees" value={stats.totalEmployees} tone="sky" />
            <StatCard label="Companies with punches today" value={stats.presentCompaniesToday} tone="amber" />
          </div>

          <Card className="mt-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-bold text-slate-900">Grace periods after a paid plan ends</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  The company admin is locked out as soon as a paid period ends. Staff keep working for these limits, counted in days after the end date.
                </p>
              </div>
              {grace && (
                <p className="text-[11px] font-semibold text-slate-400">
                  Current: hide history from day {grace.blurAfterDays} · stop punching on day {grace.punchUntilDays} · full block on day {grace.blockAfterDays}
                </p>
              )}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input label="Hide history from day" type="number" value={graceDraft.blurAfterDays} onChange={(v) => setGraceDraft({ ...graceDraft, blurAfterDays: v })} />
              <Input label="Stop punching on day" type="number" value={graceDraft.punchUntilDays} onChange={(v) => setGraceDraft({ ...graceDraft, punchUntilDays: v })} />
              <Input label="Full block on day" type="number" value={graceDraft.blockAfterDays} onChange={(v) => setGraceDraft({ ...graceDraft, blockAfterDays: v })} />
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Defaults: {DEFAULT_GRACE_POLICY.blurAfterDays}, {DEFAULT_GRACE_POLICY.punchUntilDays} and {DEFAULT_GRACE_POLICY.blockAfterDays} days. Each limit must be the same as or later than the one before it.
            </p>
            {graceError && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{graceError}</p>}
            <Button size="sm" className="mt-3 w-full sm:w-auto" loading={graceSaving} onClick={saveGrace}>Save grace periods</Button>
          </Card>

          <Card className="mt-4 p-3">
            <Input value={search} onChange={setSearch} placeholder="Search by company code, name, email, plan or status..." />
            <p className="mt-2 px-1 text-[11px] font-medium text-slate-400">
              Showing {filtered.length} of {companies.length} {companies.length === 1 ? "company" : "companies"}
            </p>
          </Card>

          {filtered.length === 0 ? (
            <Card className="mt-4"><p className="text-center text-sm text-slate-400">No companies match your search.</p></Card>
          ) : (
            <>
              <Card className="mt-4 hidden overflow-x-auto p-0 md:block">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Company</th>
                      <th className="px-4 py-3 font-semibold">Plan</th>
                      <th className="px-4 py-3 font-semibold">Employees</th>
                      <th className="px-4 py-3 font-semibold">Subscription</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Created</th>
                      <th className="px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filtered.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <p className="font-bold text-slate-800">{c.name}</p>
                          <p className="font-mono text-[11px] font-semibold tracking-wider text-indigo-600">{c.code ?? "no code"}</p>
                          <p className="text-xs text-slate-400">{c.email}</p>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone="indigo">{c.subscriptionPlan}</Badge>
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-700">{c.employeeCount}</td>
                        <td className="px-4 py-3 text-slate-600">
                          <p className="font-semibold text-slate-700">{accessSummary(c)}</p>
                          <p className="text-xs text-slate-400">{accessDetail(c)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={c.status === "active" ? "green" : c.status === "suspended" ? "amber" : "red"}>{c.status}</Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{formatDate(c.createdAt)}</td>
                        <td className="px-4 py-3">
                          <Button size="sm" variant="secondary" onClick={() => setEditCompany(c)}>Manage</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              <div className="mt-4 space-y-3 md:hidden">
                {filtered.map((c) => (
                  <div key={c.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-bold text-slate-800">{c.name}</p>
                        <p className="font-mono text-[11px] font-semibold tracking-wider text-indigo-600">{c.code ?? "no code"}</p>
                        <p className="truncate text-xs text-slate-400">{c.email}</p>
                      </div>
                      <Badge tone={c.status === "active" ? "green" : c.status === "suspended" ? "amber" : "red"}>{c.status}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge tone="indigo">{c.subscriptionPlan}</Badge>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{c.employeeCount} employees</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-slate-400">Subscription</p>
                        <p className="font-semibold text-slate-700">
                          {accessSummary(c)}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-400">Created</p>
                        <p className="font-semibold text-slate-700">{formatDate(c.createdAt)}</p>
                      </div>
                    </div>
                    <Button size="sm" variant="secondary" className="mt-3 w-full" onClick={() => setEditCompany(c)}>Manage</Button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Company">
        <div className="space-y-3">
          <Input label="Company name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Input label="Admin email" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <Input label="Admin password (min 8 chars)" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} placeholder="At least 8 characters" />
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            New companies start the 20-day free trial (up to 4 people). Grant a paid plan from the company&apos;s Manage panel.
          </p>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
          <Button className="w-full" onClick={createCompany} loading={saving}>Create Company</Button>
        </div>
      </Modal>

      {editCompany && (
        <Modal open onClose={closeManage} title={`Manage ${editCompany.name}`}>
          <div className="space-y-4">
            <div className="rounded-xl bg-indigo-50 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-500">Company code</p>
              <p className="font-mono text-lg font-bold tracking-widest text-indigo-900">{editCompany.code ?? "Not assigned"}</p>
            </div>
            <Select
              label="Status"
              value={editCompany.status}
              onChange={(v) => setEditCompany({ ...editCompany, status: v })}
              options={[
                { value: "active", label: "Active" },
                { value: "suspended", label: "Suspended" },
                { value: "deactivated", label: "Deactivated" },
              ]}
            />
            <Button className="w-full" onClick={() => updateCompany(editCompany.id, { status: editCompany.status })}>
              Save Changes
            </Button>

            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <div>
                <p className="text-sm font-bold text-slate-900">Subscription</p>
                <p className="mt-1 text-xs text-slate-500">{accessDetail(editCompany)}</p>
              </div>
              <Select
                label="Grant a plan (no charge)"
                value={grantPlanId}
                onChange={setGrantPlanId}
                options={[
                  { value: "", label: "Choose a plan" },
                  ...plans.map((p) => ({ value: p.id, label: `${p.name} · up to ${p.employeeLimit} employees` })),
                ]}
              />
              <Select
                label="Length"
                value={String(grantMonths)}
                onChange={(v) => setGrantMonths(Number(v))}
                options={[
                  { value: "1", label: "1 month" },
                  { value: "6", label: "6 months" },
                  { value: "12", label: "12 months" },
                ]}
              />
              <Button variant="secondary" className="w-full" disabled={!grantPlanId} loading={granting} onClick={() => grantPlan(editCompany.id)}>
                Grant subscription
              </Button>
              <p className="text-[11px] text-slate-400">
                Replaces any current trial or paid period, starting today. Use it for sales deals or offline invoices. Plans are managed in{" "}
                <Link href="/superadmin/plans" className="font-semibold text-indigo-600 hover:underline">Plans</Link>.
              </p>
            </div>

            <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4">
              <p className="text-sm font-bold text-rose-800">Danger zone</p>
              <p className="mt-1 text-xs leading-relaxed text-rose-700">
                Deleting removes this company with all of its employees, attendance, salary records, leave, agreements and feedback.
                This cannot be undone. To confirm, type the company name exactly:{" "}
                <span className="font-bold">{editCompany.name}</span>
              </p>
              <div className="mt-3">
                <Input value={deleteName} onChange={setDeleteName} placeholder={editCompany.name} />
              </div>
              {deleteError && <p className="mt-2 rounded-lg bg-white px-3 py-2 text-xs font-medium text-rose-700">{deleteError}</p>}
              <Button
                variant="danger"
                className="mt-3 w-full"
                disabled={deleteName.trim() !== editCompany.name || deleting}
                loading={deleting}
                onClick={() => deleteCompany(editCompany)}
              >
                Delete company permanently
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}