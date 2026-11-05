"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, getCurrentPosition, useMe } from "@/lib/client";
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, Modal, PageHeader, Spinner, Textarea } from "@/components/ui";

interface LocationRow {
  id: string;
  name: string;
  address: string | null;
  latitude: string;
  longitude: string;
  radiusMeters: number;
  isActive: boolean;
  employeeCount: number;
}

const emptyForm = { name: "", address: "", latitude: "", longitude: "", radiusMeters: "200" };

export default function LocationsPage() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.user.role === "company_admin";

  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LocationRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [modalError, setModalError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const data = await api<{ locations: LocationRow[] }>("/api/locations");
      setLocations(data.locations);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load locations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
    else if (!meLoading) setLoading(false);
  }, [isAdmin, meLoading, load]);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalError("");
    setModalOpen(true);
  };

  const openEdit = (l: LocationRow) => {
    setEditing(l);
    setForm({
      name: l.name,
      address: l.address ?? "",
      latitude: String(Number(l.latitude)),
      longitude: String(Number(l.longitude)),
      radiusMeters: String(l.radiusMeters),
    });
    setModalError("");
    setModalOpen(true);
  };

  const useMyLocation = async () => {
    setLocating(true);
    setModalError("");
    try {
      const pos = await getCurrentPosition();
      setForm((f) => ({ ...f, latitude: pos.lat.toFixed(6), longitude: pos.lng.toFixed(6) }));
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Location unavailable");
    } finally {
      setLocating(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setModalError("");
    try {
      const body = JSON.stringify({
        name: form.name,
        address: form.address,
        latitude: form.latitude,
        longitude: form.longitude,
        radiusMeters: form.radiusMeters,
      });
      if (editing) await api(`/api/locations/${editing.id}`, { method: "PATCH", body });
      else await api("/api/locations", { method: "POST", body });
      setModalOpen(false);
      await load();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (l: LocationRow) => {
    setBusyId(l.id);
    setActionError("");
    try {
      await api(`/api/locations/${l.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !l.isActive }) });
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusyId("");
    }
  };

  const remove = async (l: LocationRow) => {
    if (!confirm(`Delete the “${l.name}” location?`)) return;
    setBusyId(l.id);
    setActionError("");
    try {
      await api(`/api/locations/${l.id}`, { method: "DELETE" });
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
    return <EmptyState message="Only company admins can manage locations." />;
  }

  const activeCount = locations.filter((l) => l.isActive).length;

  return (
    <div>
      <PageHeader
        title="Work Locations"
        subtitle="Add every office, branch or site. Employees punch in within the radius of their assigned locations."
        action={<Button size="sm" onClick={openAdd}>+ Add Location</Button>}
      />

      {loadError && <ErrorBanner message={loadError} onRetry={load} />}
      {actionError && <ErrorBanner message={actionError} />}

      {!loadError && locations.length > 0 && activeCount === 0 && (
        <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          All locations are inactive — nobody can punch in until one is activated.
        </p>
      )}

      {!loadError && locations.length === 0 ? (
        <EmptyState message="No locations yet. Add your first work location — you need at least one before employees can punch in or be added." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {locations.map((l) => (
            <div key={l.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-800">{l.name}</p>
                  {l.address && <p className="mt-0.5 text-sm text-slate-500">{l.address}</p>}
                </div>
                <Badge tone={l.isActive ? "green" : "slate"}>{l.isActive ? "Active" : "Inactive"}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-slate-400">Punch radius</p>
                  <p className="font-semibold text-slate-700">{l.radiusMeters} m</p>
                </div>
                <div>
                  <p className="text-slate-400">Assigned</p>
                  <p className="font-semibold text-slate-700">
                    {l.employeeCount} {l.employeeCount === 1 ? "employee" : "employees"}
                  </p>
                </div>
              </div>
              <a
                href={`https://www.google.com/maps?q=${Number(l.latitude)},${Number(l.longitude)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs font-semibold text-indigo-600 hover:underline"
              >
                {Number(l.latitude).toFixed(5)}, {Number(l.longitude).toFixed(5)} · view on map ↗
              </a>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" className="flex-1" onClick={() => openEdit(l)}>Edit</Button>
                <Button size="sm" variant="secondary" className="flex-1" loading={busyId === l.id} onClick={() => toggleActive(l)}>
                  {l.isActive ? "Deactivate" : "Activate"}
                </Button>
                <Button size="sm" variant="danger" className="flex-1" disabled={busyId === l.id} onClick={() => remove(l)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Card className="mt-4 text-xs text-slate-500">
        An employee with no location assigned can punch at any active location. Assign locations when you{" "}
        <Link href="/employees" className="font-semibold text-indigo-600 hover:underline">add or edit an employee</Link>.
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${editing.name}` : "Add location"}>
        <div className="space-y-3">
          <Input label="Location name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="e.g. Head Office, Kochi Branch" />
          <Textarea label="Address (optional)" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
          <Button variant="secondary" className="w-full" loading={locating} onClick={useMyLocation}>
            📍 Use my current location
          </Button>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Latitude" value={form.latitude} onChange={(v) => setForm({ ...form, latitude: v })} placeholder="12.971598" />
            <Input label="Longitude" value={form.longitude} onChange={(v) => setForm({ ...form, longitude: v })} placeholder="77.594566" />
          </div>
          <Input label="Punch radius (meters, 20–10,000)" type="number" value={form.radiusMeters} onChange={(v) => setForm({ ...form, radiusMeters: v })} />
          {modalError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{modalError}</p>}
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" className="flex-1" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button className="flex-1" loading={saving} onClick={save} disabled={!form.name.trim()}>
              {editing ? "Save Changes" : "Add Location"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
