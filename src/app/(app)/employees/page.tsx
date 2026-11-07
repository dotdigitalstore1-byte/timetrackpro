"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, hasPower, useMe } from "@/lib/client";
import { Badge, Button, Card, ChipSelect, EmptyState, ErrorBanner, Input, Modal, PageHeader, Select, Spinner } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/utils";

interface OrgRef {
  id: string;
  name: string;
}

interface OrgOption extends OrgRef {
  isActive: boolean;
}

interface EmployeeRow {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  employeeCode: string | null;
  department: string | null;
  departments: OrgRef[];
  locations: OrgRef[];
  designation: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  basicSalary: string | null;
  hireDate: string;
  managerId: string | null;
  managerName: string | null;
}

const emptyForm = {
  fullName: "",
  email: "",
  password: "",
  role: "employee",
  employeeCode: "",
  designation: "",
  shiftStart: "09:00",
  shiftEnd: "18:00",
  basicSalary: "",
  phone: "",
  managerId: "",
  departmentIds: [] as string[],
  locationIds: [] as string[],
};

/** Active options, plus any inactive ones the employee is already assigned to (so they are not silently dropped). */
function orgOptions(all: OrgOption[], selected: string[]) {
  return all
    .filter((o) => o.isActive || selected.includes(o.id))
    .map((o) => ({ value: o.id, label: o.isActive ? o.name : `${o.name} (inactive)`, muted: !o.isActive }));
}

function OrgChips({ items, legacy }: { items: OrgRef[]; legacy?: string | null }) {
  if (items.length === 0) {
    return <span className="text-slate-400">{legacy || "—"}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((i) => (
        <span key={i.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
          {i.name}
        </span>
      ))}
    </div>
  );
}

export default function EmployeesPage() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.user.role === "company_admin";
  // Admins, and managers with the manage_employees power, can add and edit people (salary is admin-only).
  const canManage = hasPower(me, "manage_employees");
  const currency = me?.settings?.currency ?? "$";

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [departments, setDepartments] = useState<OrgOption[]>([]);
  const [locations, setLocations] = useState<OrgOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      // Departments and locations are only needed (and only permitted) for admins.
      const [emp, dept, loc] = await Promise.all([
        api<{ employees: EmployeeRow[] }>("/api/employees"),
        canManage ? api<{ departments: OrgOption[] }>("/api/departments") : Promise.resolve(null),
        canManage ? api<{ locations: OrgOption[] }>("/api/locations") : Promise.resolve(null),
      ]);
      setEmployees(emp.employees);
      if (dept) setDepartments(dept.departments);
      if (loc) setLocations(loc.locations);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load employees");
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    if (me) void load();
    else if (!meLoading) setLoading(false);
  }, [me, meLoading, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      [e.fullName, e.email, e.employeeCode, e.department, e.designation, e.role, ...e.locations.map((l) => l.name)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [employees, search]);

  const openAdd = () => {
    setEditing(null);
    // With only one active department / location there is nothing to choose, so pre-select it.
    const activeDepartments = departments.filter((d) => d.isActive);
    const activeLocations = locations.filter((l) => l.isActive);
    setForm({
      ...emptyForm,
      shiftStart: me?.settings?.shiftStart ?? emptyForm.shiftStart,
      shiftEnd: me?.settings?.shiftEnd ?? emptyForm.shiftEnd,
      departmentIds: activeDepartments.length === 1 ? [activeDepartments[0].id] : [],
      locationIds: activeLocations.length === 1 ? [activeLocations[0].id] : [],
    });
    setError("");
    setModalOpen(true);
  };

  const openEdit = (e: EmployeeRow) => {
    setEditing(e);
    setForm({
      fullName: e.fullName,
      email: e.email,
      password: "",
      role: e.role,
      employeeCode: e.employeeCode ?? "",
      designation: e.designation ?? "",
      shiftStart: e.shiftStart ?? me?.settings?.shiftStart ?? emptyForm.shiftStart,
      shiftEnd: e.shiftEnd ?? me?.settings?.shiftEnd ?? emptyForm.shiftEnd,
      basicSalary: e.basicSalary ?? "",
      phone: e.phone ?? "",
      managerId: e.managerId ?? "",
      departmentIds: e.departments.map((d) => d.id),
      locationIds: e.locations.map((l) => l.id),
    });
    setError("");
    setModalOpen(true);
  };

  const save = async () => {
    setError("");
    if (form.departmentIds.length === 0) {
      setError("Select at least one department.");
      return;
    }
    if (form.locationIds.length === 0) {
      setError("Select at least one work location.");
      return;
    }
    if (!form.shiftStart || !form.shiftEnd) {
      setError("Enter the punch-in and punch-out time.");
      return;
    }
    if (form.shiftEnd <= form.shiftStart) {
      setError("Punch-out time must be later than punch-in time.");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api(`/api/employees/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            fullName: form.fullName,
            phone: form.phone,
            employeeCode: form.employeeCode,
            designation: form.designation,
            shiftStart: form.shiftStart,
            shiftEnd: form.shiftEnd,
            basicSalary: form.basicSalary,
            departmentIds: form.departmentIds,
            locationIds: form.locationIds,
            ...(form.password ? { password: form.password } : {}),
          }),
        });
      } else {
        await api("/api/employees", {
          method: "POST",
          body: JSON.stringify({ ...form, role: "employee", managerId: null }),
        });
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (e: EmployeeRow) => {
    if (!confirm(`Deactivate ${e.fullName}? They will no longer be able to sign in.`)) return;
    try {
      await api(`/api/employees/${e.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to deactivate");
    }
  };

  const reactivate = async (e: EmployeeRow) => {
    try {
      await api(`/api/employees/${e.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: true }),
      });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to reactivate");
    }
  };

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle={isAdmin ? "Manage employees and salaries" : canManage ? "Manage your team" : "View your team"}
        action={canManage ? <Button size="sm" onClick={openAdd}>+ Add Employee</Button> : undefined}
      />

      <Card className="mb-4 p-3">
        <Input
          value={search}
          onChange={setSearch}
          placeholder="Search by name, email, department or code..."
        />
        <p className="mt-2 px-1 text-[11px] font-medium text-slate-400">
          Showing {filtered.length} of {employees.length} {employees.length === 1 ? "person" : "people"}
        </p>
      </Card>

      {canManage && !loading && !loadError && (departments.length === 0 || locations.length === 0) && (
        <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          Before adding employees, set up{" "}
          {departments.length === 0 && <Link href="/departments" className="font-bold underline">departments</Link>}
          {departments.length === 0 && locations.length === 0 && " and "}
          {locations.length === 0 && <Link href="/locations" className="font-bold underline">work locations</Link>}.
        </div>
      )}

      {loadError && <ErrorBanner message={loadError} onRetry={load} />}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : loadError ? null : employees.length === 0 ? (
        <EmptyState message="No employees yet. Click “+ Add Employee” to get started." />
      ) : filtered.length === 0 ? (
        <EmptyState message={`No employees match “${search}”.`} />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Employee</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Departments</th>
                  <th className="px-4 py-3 font-semibold">Locations</th>
                  <th className="px-4 py-3 font-semibold">Designation</th>
                  <th className="px-4 py-3 font-semibold">Shift</th>
                  <th className="px-4 py-3 font-semibold">Basic Salary</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  {canManage && <th className="px-4 py-3 font-semibold">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-800">{e.fullName}</p>
                      <p className="text-xs text-slate-400">{e.email} · {e.employeeCode || "—"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={e.role === "manager" ? "indigo" : "slate"}>{e.role}</Badge>
                    </td>
                    <td className="px-4 py-3"><OrgChips items={e.departments} legacy={e.department} /></td>
                    <td className="px-4 py-3"><OrgChips items={e.locations} /></td>
                    <td className="px-4 py-3 text-slate-600">{e.designation || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{e.shiftStart && e.shiftEnd ? `${e.shiftStart} – ${e.shiftEnd}` : "—"}</td>
                    <td className="px-4 py-3 font-semibold text-slate-700">
                      {e.basicSalary == null ? "—" : `${currency}${formatNumber(e.basicSalary)}`}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={e.isActive ? "green" : "red"}>{e.isActive ? "Active" : "Inactive"}</Badge>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="secondary" onClick={() => openEdit(e)}>Edit</Button>
                          {isAdmin && (e.isActive ? (
                            <Button size="sm" variant="danger" onClick={() => deactivate(e)}>Remove</Button>
                          ) : (
                            <Button size="sm" variant="success" onClick={() => reactivate(e)}>Reactivate</Button>
                          ))}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {filtered.map((e) => (
              <div key={e.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-800">{e.fullName}</p>
                    <p className="truncate text-xs text-slate-400">{e.email}</p>
                  </div>
                  <Badge tone={e.isActive ? "green" : "red"}>{e.isActive ? "Active" : "Inactive"}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge tone={e.role === "manager" ? "indigo" : "slate"}>{e.role}</Badge>
                  {e.designation && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{e.designation}</span>}
                </div>
                <div className="mt-3 space-y-2 text-xs">
                  <div>
                    <p className="mb-1 text-slate-400">Departments</p>
                    <OrgChips items={e.departments} legacy={e.department} />
                  </div>
                  <div>
                    <p className="mb-1 text-slate-400">Shift (punch-in – punch-out)</p>
                    <p className="font-semibold text-slate-600">{e.shiftStart && e.shiftEnd ? `${e.shiftStart} – ${e.shiftEnd}` : "—"}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-slate-400">Work locations</p>
                    <OrgChips items={e.locations} />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-slate-400">Employee code</p>
                    <p className="font-semibold text-slate-700">{e.employeeCode || "—"}</p>
                  </div>
                  {isAdmin && (
                    <div>
                      <p className="text-slate-400">Basic salary</p>
                      <p className="font-semibold text-slate-700">
                        {e.basicSalary == null ? "—" : `${currency}${formatNumber(e.basicSalary)}`}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-slate-400">Joined</p>
                    <p className="font-semibold text-slate-700">{formatDate(e.hireDate)}</p>
                  </div>
                </div>
                {canManage && (
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="secondary" className="flex-1" onClick={() => openEdit(e)}>Edit</Button>
                    {isAdmin && (e.isActive ? (
                      <Button size="sm" variant="danger" className="flex-1" onClick={() => deactivate(e)}>Remove</Button>
                    ) : (
                      <Button size="sm" variant="success" className="flex-1" onClick={() => reactivate(e)}>Reactivate</Button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${editing.fullName}` : "Add Employee"}>
        <div className="space-y-3">
          <Input label="Full name" value={form.fullName} onChange={(v) => setForm({ ...form, fullName: v })} />
          <Input label={editing ? "Email (cannot be changed)" : "Email"} type="email" disabled={!!editing} value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <Input
            label={editing ? "New password (leave blank to keep current)" : "Password (min 8 chars)"}
            type="password"
            value={form.password}
            onChange={(v) => setForm({ ...form, password: v })}
            placeholder={editing ? "Optional reset" : "At least 8 characters"}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Employee code" value={form.employeeCode} onChange={(v) => setForm({ ...form, employeeCode: v })} />
          </div>
          <Input label="Designation" value={form.designation} onChange={(v) => setForm({ ...form, designation: v })} />
          <div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Punch-in time" type="time" value={form.shiftStart} onChange={(v) => setForm({ ...form, shiftStart: v })} />
              <Input label="Punch-out time" type="time" value={form.shiftEnd} onChange={(v) => setForm({ ...form, shiftEnd: v })} />
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              This employee&apos;s shift. Late arrival, the cool-off time and early leave are all measured against it. You can change it any time.
            </p>
          </div>
          <ChipSelect
            label="Departments"
            required
            values={form.departmentIds}
            onChange={(departmentIds) => setForm({ ...form, departmentIds })}
            options={orgOptions(departments, form.departmentIds)}
            emptyHint={<>No departments yet. <Link href="/departments" className="font-bold underline">Add a department</Link> first.</>}
          />
          <ChipSelect
            label="Work locations"
            required
            values={form.locationIds}
            onChange={(locationIds) => setForm({ ...form, locationIds })}
            options={orgOptions(locations, form.locationIds)}
            emptyHint={<>No locations yet. <Link href="/locations" className="font-bold underline">Add a work location</Link> first.</>}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {isAdmin && <Input label="Basic salary (monthly)" type="number" value={form.basicSalary} onChange={(v) => setForm({ ...form, basicSalary: v })} />}
            <Input label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          </div>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={save} loading={saving}>{editing ? "Save Changes" : "Add Employee"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}