"use client";

import { useCallback, useEffect, useState } from "react";
import { api, useMe } from "@/lib/client";
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, Modal, PageHeader, Spinner } from "@/components/ui";

interface PermissionInfo {
  key: string;
  label: string;
  description: string;
}
interface Named {
  id: string;
  name: string;
  isActive?: boolean;
}
interface ManagerRow {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  permissions: string[];
  departments: Named[];
  locations: Named[];
  teamSize: number;
}
interface Draft {
  id?: string;
  fullName: string;
  email: string;
  password: string;
  phone: string;
  departmentIds: string[];
  locationIds: string[];
  permissions: string[];
  isActive: boolean;
}

const EMPTY: Draft = {
  fullName: "",
  email: "",
  password: "",
  phone: "",
  departmentIds: [],
  locationIds: [],
  permissions: ["approve_leaves", "view_photos", "view_reports"],
  isActive: true,
};

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function ManagersPage() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.access.isAdmin === true;

  const [managers, setManagers] = useState<ManagerRow[]>([]);
  const [catalog, setCatalog] = useState<PermissionInfo[]>([]);
  const [departments, setDepartments] = useState<Named[]>([]);
  const [locations, setLocations] = useState<Named[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await api<{ managers: ManagerRow[]; permissionCatalog: PermissionInfo[]; departments: Named[]; locations: Named[] }>("/api/managers");
      setManagers(data.managers);
      setCatalog(data.permissionCatalog);
      setDepartments(data.departments.filter((d) => d.isActive !== false));
      setLocations(data.locations.filter((l) => l.isActive !== false));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load managers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
    else if (!meLoading) setLoading(false);
  }, [isAdmin, meLoading, load]);

  const openNew = () => {
    setFormError("");
    setDraft({ ...EMPTY });
  };
  const openEdit = (m: ManagerRow) => {
    setFormError("");
    setDraft({
      id: m.id,
      fullName: m.fullName,
      email: m.email,
      password: "",
      phone: m.phone ?? "",
      departmentIds: m.departments.map((d) => d.id),
      locationIds: m.locations.map((l) => l.id),
      permissions: m.permissions,
      isActive: m.isActive,
    });
  };

  const save = async () => {
    if (!draft) return;
    setFormError("");
    if (!draft.fullName.trim()) return setFormError("Enter the manager's name.");
    if (!draft.id && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email)) return setFormError("Enter a valid email address.");
    if (!draft.id && draft.password.length < 8) return setFormError("The password must be at least 8 characters.");
    if (draft.id && draft.password && draft.password.length < 8) return setFormError("A new password must be at least 8 characters.");
    if (draft.departmentIds.length === 0) return setFormError("Choose at least one department.");
    if (draft.locationIds.length === 0) return setFormError("Choose at least one work location.");

    setSaving(true);
    try {
      if (draft.id) {
        await api(`/api/managers/${draft.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            fullName: draft.fullName,
            phone: draft.phone,
            departmentIds: draft.departmentIds,
            locationIds: draft.locationIds,
            permissions: draft.permissions,
            isActive: draft.isActive,
            ...(draft.password ? { password: draft.password } : {}),
          }),
        });
      } else {
        await api("/api/managers", {
          method: "POST",
          body: JSON.stringify({
            fullName: draft.fullName,
            email: draft.email,
            password: draft.password,
            phone: draft.phone,
            departmentIds: draft.departmentIds,
            locationIds: draft.locationIds,
            permissions: draft.permissions,
          }),
        });
      }
      setDraft(null);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not save the manager");
    } finally {
      setSaving(false);
    }
  };

  if (meLoading) return <div className="flex justify-center py-16"><Spinner /></div>;
  if (!isAdmin) return <EmptyState message="Only company admins can manage managers." />;

  const noSetup = departments.length === 0 || locations.length === 0;

  return (
    <div>
      <PageHeader
        title="Managers"
        subtitle="Managers look after their own departments and locations. You choose exactly which powers each one has."
        action={<Button size="sm" onClick={openNew} disabled={noSetup}>+ Add manager</Button>}
      />

      {noSetup && (
        <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          Add at least one department and one work location before creating a manager.
        </p>
      )}
      {error && <div className="mb-4"><ErrorBanner message={error} onRetry={load} /></div>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : managers.length === 0 ? (
        <EmptyState message="No managers yet. Add one to hand over a department's leave approvals and attendance." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {managers.map((m) => (
            <Card key={m.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-bold text-slate-900">{m.fullName}</h3>
                  <p className="truncate text-xs text-slate-500">{m.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!m.isActive && <Badge tone="slate">Inactive</Badge>}
                  <Button size="sm" variant="secondary" onClick={() => openEdit(m)}>Edit</Button>
                </div>
              </div>

              <div className="mt-4 space-y-3 text-sm">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Departments</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {m.departments.length ? m.departments.map((d) => <Badge key={d.id} tone="indigo">{d.name}</Badge>) : <span className="text-xs text-rose-600">None assigned</span>}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Locations</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {m.locations.length ? m.locations.map((l) => <Badge key={l.id} tone="slate">{l.name}</Badge>) : <span className="text-xs text-rose-600">None assigned</span>}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Powers</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {m.permissions.length ? (
                      m.permissions.map((p) => (
                        <span key={p} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                          {catalog.find((c) => c.key === p)?.label ?? p}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-slate-500">View-only (no powers granted)</span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-500">Team: {m.teamSize} employee{m.teamSize === 1 ? "" : "s"}</p>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!draft} onClose={() => !saving && setDraft(null)} title={draft?.id ? "Edit manager" : "Add manager"}>
        {draft && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Full name" value={draft.fullName} onChange={(v) => setDraft({ ...draft, fullName: v })} />
              <Input label="Phone" value={draft.phone} onChange={(v) => setDraft({ ...draft, phone: v })} />
              <Input
                label="Email (login)"
                type="email"
                value={draft.email}
                onChange={(v) => setDraft({ ...draft, email: v })}
                disabled={!!draft.id}
              />
              <Input
                label={draft.id ? "New password (optional)" : "Password"}
                type="password"
                value={draft.password}
                onChange={(v) => setDraft({ ...draft, password: v })}
                placeholder="At least 8 characters"
              />
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-slate-700">Departments they manage</legend>
              <p className="mb-2 text-xs text-slate-500">One department can have several managers.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {departments.map((d) => (
                  <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.departmentIds.includes(d.id)}
                      onChange={() => setDraft({ ...draft, departmentIds: toggle(draft.departmentIds, d.id) })}
                    />
                    {d.name}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-slate-700">Work locations they cover</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {locations.map((l) => (
                  <label key={l.id} className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.locationIds.includes(l.id)}
                      onChange={() => setDraft({ ...draft, locationIds: toggle(draft.locationIds, l.id) })}
                    />
                    {l.name}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-slate-700">Powers</legend>
              <div className="space-y-2">
                {catalog.map((p) => (
                  <label key={p.key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={draft.permissions.includes(p.key)}
                      onChange={() => setDraft({ ...draft, permissions: toggle(draft.permissions, p.key) })}
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">{p.label}</span>
                      <span className="block text-xs text-slate-500">{p.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {draft.id && (
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
                Account active (uncheck to stop them signing in)
              </label>
            )}

            {formError && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{formError}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDraft(null)} disabled={saving}>Cancel</Button>
              <Button onClick={save} loading={saving}>{draft.id ? "Save changes" : "Create manager"}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
