"use client";

import { useCallback, useEffect, useState } from "react";
import { api, hasPower, useMe } from "@/lib/client";
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner } from "@/components/ui";
import { formatDate, formatDayKey, formatTime, workingHours } from "@/lib/utils";
import { attendanceCounts } from "@/lib/attendance-stats";
import EmployeePicker from "@/components/EmployeePicker";

interface AttendanceRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode?: string | null;
  workDate: string;
  punchInTime: string | null;
  punchOutTime: string | null;
  hasPunchInPhoto: boolean;
  hasPunchOutPhoto: boolean;
  status: string;
  isManual: boolean;
  note: string | null;
  earlyLeaveMinutes?: number;
  overtimeMinutes?: number;
}

interface EmployeeOption {
  id: string;
  fullName: string;
  employeeCode?: string | null;
}

/** Small notes under a punch-out: "left 20 min early" / "+1h 10m overtime". */
function TimeNotes({ r }: { r: AttendanceRow }) {
  const early = r.earlyLeaveMinutes ?? 0;
  const ot = r.overtimeMinutes ?? 0;
  if (!r.punchOutTime || (early <= 0 && ot <= 0)) return null;
  const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
  return (
    <span className={`block text-[10px] font-bold ${early > 0 ? "text-amber-600" : "text-emerald-600"}`}>
      {early > 0 ? `${fmt(early)} early` : `+${fmt(ot)} overtime`}
    </span>
  );
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusTone(status: string): "green" | "amber" | "red" | "slate" {
  return status === "present" ? "green" : status === "late" ? "amber" : status === "half_day" ? "red" : "slate";
}

function Photos({ record, allowed }: { record: AttendanceRow; allowed: boolean }) {
  if (!allowed) return <span className="text-xs text-slate-300">Restricted</span>;
  return (
    <div className="flex gap-1.5">
      {record.hasPunchInPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/attendance/${record.id}/photo?which=in`} alt="Punch in" className="h-9 w-9 rounded-md object-cover ring-1 ring-slate-200" />
      ) : <span className="text-xs text-slate-300">—</span>}
      {record.hasPunchOutPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/attendance/${record.id}/photo?which=out`} alt="Punch out" className="h-9 w-9 rounded-md object-cover ring-1 ring-slate-200" />
      ) : <span className="text-xs text-slate-300">—</span>}
    </div>
  );
}

export default function AttendancePage() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = me?.user.role === "company_admin";
  const isManager = me?.user.role === "manager";
  const canViewAll = isAdmin || isManager;
  const canManage = hasPower(me, "manage_attendance");
  const canSeePhotos = hasPower(me, "view_photos");

  // Empty = the current salary cycle (the server decides which cycle that is).
  const [month, setMonth] = useState("");
  const [period, setPeriod] = useState<{ start: string; end: string } | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<AttendanceRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      if (month) qs.set("month", month);
      if (canViewAll && employeeId) qs.set("employeeId", employeeId);
      const data = await api<{ records: AttendanceRow[]; period?: { start: string; end: string } }>(`/api/attendance?${qs}`);
      setRecords(data.records);
      setPeriod(data.period ?? null);
    } catch (e) {
      setRecords([]);
      setError(e instanceof Error ? e.message : "Could not load attendance");
    } finally {
      setLoading(false);
    }
  }, [month, employeeId, canViewAll]);

  useEffect(() => {
    if (!meLoading) void load();
  }, [load, meLoading]);

  useEffect(() => {
    if (canViewAll && employees.length === 0) {
      api<{ employees: EmployeeOption[] }>("/api/employees")
        .then((d) => setEmployees(d.employees))
        .catch(() => setEmployees([]));
    }
  }, [canViewAll, employees.length]);

  // Same counts as the Home page (src/lib/attendance-stats.ts), so the two always match.
  const counts = attendanceCounts(records);

  return (
    <div>
      <PageHeader title="Attendance" subtitle="Photo-verified punches with GPS geofencing" />


      <Card className="mb-4">
        <div className={`grid gap-3 ${isAdmin ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`}>
          <div>
            <Input label="Salary cycle" type="month" value={month} onChange={setMonth} />
            {period && (
              <p className="mt-1 text-[11px] text-slate-400">
                {formatDayKey(period.start)} → {formatDayKey(period.end)}
              </p>
            )}
          </div>
          {canViewAll && (
            <EmployeePicker
              label="Employee"
              value={employeeId}
              onChange={setEmployeeId}
              allLabel="All employees"
              items={employees.map((e) => ({ id: e.id, name: e.fullName, code: e.employeeCode }))}
            />
          )}
        </div>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : error ? (
        <Card>
          <p className="text-center text-sm font-medium text-rose-600">{error}</p>
          <div className="mt-3 flex justify-center">
            <Button size="sm" variant="secondary" onClick={load}>Try again</Button>
          </div>
        </Card>
      ) : records.length === 0 ? (
        <EmptyState message="No attendance records for the selected period." />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-4 gap-2">
            {[
              { label: "Present", value: counts.present, cls: "bg-emerald-50 text-emerald-700" },
              { label: "Late", value: counts.late, cls: "bg-amber-50 text-amber-700" },
              { label: "Half day", value: counts.half, cls: "bg-rose-50 text-rose-700" },
              { label: "No punch", value: counts.absent, cls: "bg-slate-100 text-slate-600" },
            ].map((s) => (
              <div key={s.label} className={`rounded-xl p-2.5 text-center ${s.cls}`}>
                <p className="text-lg font-bold">{s.value}</p>
                <p className="text-[10px] font-bold uppercase tracking-wide">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <Card className="hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  {canViewAll && <th className="px-4 py-3 font-semibold">Employee</th>}
                  <th className="px-4 py-3 font-semibold">Punch In</th>
                  <th className="px-4 py-3 font-semibold">Punch Out</th>
                  <th className="px-4 py-3 font-semibold">Hours</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Photos</th>
                  {canManage && <th className="px-4 py-3 font-semibold">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {records.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-semibold text-slate-700">
                      {formatDate(r.workDate)}
                      {r.isManual && <span className="ml-1 text-[10px] font-bold text-indigo-500">EDITED</span>}
                    </td>
                    {canViewAll && (
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-700">{r.employeeName}</p>
                        {r.employeeCode && <p className="font-mono text-[11px] text-slate-400">{r.employeeCode}</p>}
                      </td>
                    )}
                    <td className="px-4 py-3 text-slate-600">{formatTime(r.punchInTime)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatTime(r.punchOutTime)}<TimeNotes r={r} /></td>
                    <td className="px-4 py-3 text-slate-600">{workingHours(r.punchInTime, r.punchOutTime)}</td>
                    <td className="px-4 py-3"><Badge tone={statusTone(r.status)}>{r.status.replace("_", " ")}</Badge></td>
                    <td className="px-4 py-3"><Photos record={r} allowed={canSeePhotos} /></td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>Edit</Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {records.map((r) => (
              <div key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-800">{formatDate(r.workDate)}</p>
                    {canViewAll && <p className="text-xs text-slate-500">{r.employeeName}{r.employeeCode ? ` · ${r.employeeCode}` : ""}</p>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {r.isManual && <span className="text-[10px] font-bold text-indigo-500">EDITED</span>}
                    <Badge tone={statusTone(r.status)}>{r.status.replace("_", " ")}</Badge>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-slate-50 p-2">
                    <p className="text-[10px] font-bold uppercase text-slate-400">In</p>
                    <p className="text-sm font-bold text-slate-700">{formatTime(r.punchInTime)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-2">
                    <p className="text-[10px] font-bold uppercase text-slate-400">Out</p>
                    <p className="text-sm font-bold text-slate-700">{formatTime(r.punchOutTime)}</p>
                    <TimeNotes r={r} />
                  </div>
                  <div className="rounded-xl bg-slate-50 p-2">
                    <p className="text-[10px] font-bold uppercase text-slate-400">Hours</p>
                    <p className="text-sm font-bold text-slate-700">{workingHours(r.punchInTime, r.punchOutTime)}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <Photos record={r} allowed={canSeePhotos} />
                  {canManage && (
                    <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>Edit</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {editing && <EditModal record={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function EditModal({ record, onClose, onSaved }: { record: AttendanceRow; onClose: () => void; onSaved: () => void }) {
  const [punchIn, setPunchIn] = useState(toLocalInput(record.punchInTime));
  const [punchOut, setPunchOut] = useState(toLocalInput(record.punchOutTime));
  const [status, setStatus] = useState(record.status);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");

  const remove = async () => {
    if (reason.trim().length < 3) return setError("Enter a reason before removing this record (it is kept in the audit log).");
    if (!window.confirm("Remove this attendance record? Its punches will no longer count for pay.")) return;
    setRemoving(true);
    setError("");
    try {
      await api(`/api/attendance/${record.id}`, { method: "DELETE", body: JSON.stringify({ reason }) });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the record");
      setRemoving(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await api(`/api/attendance/${record.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          punchInTime: punchIn ? new Date(punchIn).toISOString() : null,
          punchOutTime: punchOut ? new Date(punchOut).toISOString() : null,
          ...(status !== record.status ? { status } : {}),
          reason,
        }),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Edit Attendance — ${record.employeeName}`}>
      <div className="space-y-3">
        <Input label="Punch In" type="datetime-local" value={punchIn} onChange={setPunchIn} />
        <Input label="Punch Out" type="datetime-local" value={punchOut} onChange={setPunchOut} />
        <Select
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "present", label: "Present" },
            { value: "late", label: "Late" },
            { value: "half_day", label: "Half day" },
            { value: "absent", label: "Absent" },
          ]}
        />
        <Input label="Reason (audit trail)" value={reason} onChange={setReason} placeholder="Explain the correction" />
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" onClick={save} loading={saving}>Save Changes</Button>
        </div>
        <div className="border-t border-slate-100 pt-3">
          <Button variant="danger" className="w-full" onClick={remove} loading={removing}>Remove this attendance record</Button>
        </div>
        <p className="text-[11px] text-slate-400">All changes are recorded in the audit trail with your name and reason.</p>
      </div>
    </Modal>
  );
}