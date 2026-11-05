"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, useMe } from "@/lib/client";
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, Modal, PageHeader, Spinner, Textarea } from "@/components/ui";

interface DepartmentRow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  employeeCount: number;
}

export default function DepartmentsPage() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.user.role === "company_admin";

  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  const [editing, setEditing] = useState<DepartmentRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const data = await api<{ departments: DepartmentRow[] }>("/api/departments");
      setDepartments(data.departments);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load departments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
    else if (!meLoading) setLoading(false);
  }, [isAdmin, meLoading, load]);

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    setActionError("");
    try {
      await api("/api/departments", { method: "POST", body: JSON.stringify({ name }) });
      setNewName("");
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not add the department");
    } finally {
      setAdding(false);
    }
  };

  const openEdit = (d: DepartmentRow) => {
    setEditing(d);
    setEditName(d.name);
    setEditDescription(d.description ?? "");
    setModalError("");
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    setModalError("");
    try {
      await api(`/api/departments/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: editName, description: editDescription }),
      });
      setEditing(null);
      await load();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (d: DepartmentRow) => {
    setBusyId(d.id);
    setActionError("");
    try {
      await api(`/api/departments/${d.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !d.isActive }) });
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusyId("");
    }
  };

  const remove = async (d: DepartmentRow) => {
    const extra = d.employeeCount > 0 ? ` ${d.employeeCount} employee(s) will be removed from it.` : "";
    if (!confirm(`Delete the “${d.name}” department?${extra}`)) return;
    setBusyId(d.id);
    setActionError("");
    try {
      await api(`/api/departments/${d.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusyId("");
    }
  };

  if (meLoading || (loading && isAdmin)) {
    return <div className="flex justify-center py-16"><Spinner /></div>;
  }
  if (!isAdmin) {
    return <EmptyState message="Only company admins can manage departments." />;
  }

  return (
    <div>
      <PageHeader
        title="Departments"
        subtitle="Create as many departments as you need, then assign them to employees"
        action={<Link href="/employees"><Button variant="secondary" size="sm">Employees</Button></Link>}
      />

      {loadError && <ErrorBanner message={loadError} onRetry={load} />}
      {actionError && <ErrorBanner message={actionError} />}

      <Card className="mb-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Add department</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <Input value={newName} onChange={setNewName} placeholder="e.g. Sales, Engineering, HR" />
          </div>
          <Button onClick={add} loading={adding} disabled={!newName.trim()} className="sm:w-auto">+ Add</Button>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">There is no limit on the number of departments.</p>
      </Card>

      {!loadError && departments.length === 0 ? (
        <EmptyState message="No departments yet. Add your first department above — you need at least one before you can add employees." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {departments.map((d) => (
            <div key={d.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-800">{d.name}</p>
                  <p className="text-xs text-slate-400">
                    {d.employeeCount} {d.employeeCount === 1 ? "employee" : "employees"}
                  </p>
                </div>
                <Badge tone={d.isActive ? "green" : "slate"}>{d.isActive ? "Active" : "Inactive"}</Badge>
              </div>
              {d.description && <p className="mt-2 text-sm text-slate-500">{d.description}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" className="flex-1" onClick={() => openEdit(d)}>Edit</Button>
                <Button size="sm" variant="secondary" className="flex-1" loading={busyId === d.id} onClick={() => toggleActive(d)}>
                  {d.isActive ? "Deactivate" : "Activate"}
                </Button>
                <Button size="sm" variant="danger" className="flex-1" disabled={busyId === d.id} onClick={() => remove(d)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit department">
        <div className="space-y-3">
          <Input label="Name" value={editName} onChange={setEditName} />
          <Textarea label="Description (optional)" value={editDescription} onChange={setEditDescription} />
          {modalError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{modalError}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={() => setEditing(null)}>Cancel</Button>
            <Button className="flex-1" loading={saving} onClick={saveEdit} disabled={!editName.trim()}>Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
