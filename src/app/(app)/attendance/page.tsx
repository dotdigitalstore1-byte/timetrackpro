"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, hasPower, useMe } from "@/lib/client";
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner } from "@/components/ui";
import { formatDayKey, formatTime, workingHours } from "@/lib/utils";
import { EMPTY_CYCLE_COUNTS, calendarTone, statusLabel, statusTone, type CycleCounts } from "@/lib/attendance-stats";
import { weekdayOf } from "@/lib/attendance-days";
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

/** One calendar date of the cycle (single employee view): the stored record if there is one, otherwise its status. */
interface CalendarDayRow {
  date: string; // YYYY-MM-DD
  weekday: string;
  kind: string; // record | off | leave | absent | pending | upcoming
  label: string; // "Sunday", "Leave", "Absent", ...
  note: string;
  record: AttendanceRow | null;
  employeeName: string;
  employeeCode: string | null;
}

interface EmployeeOption {
  id: string;
  fullName: string;
  employeeCode?: string | null;
}

/** One line of the list: a stored record, or a calendar date with no record. */
interface ListItem {
  key: string;
  date: string;
  employeeName: string;
  employeeCode: string | null;
  record: AttendanceRow | null;
  kind: string;
  label: string;
  note: string;
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

/** Badge for a list line: the record's status, or the date's own status (Sunday, Leave, Absent, ...). */
function StatusBadge({ item }: { item: ListItem }) {
  if (item.record) return <Badge tone={statusTone(item.record.status)}>{statusLabel(item.record.status)}</Badge>;
  return <Badge tone={calendarTone(item.kind)}>{item.label}</Badge>;
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

/** Moves a salary-cycle key (YYYY-MM) forward or back by whole months. */
function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

type ListView = "all" | "issues" | "punched";
const LIST_VIEWS: { key: ListView; label: string }[] = [
  { key: "all", label: "All days" },
  { key: "punched", label: "Punched" },
  { key: "issues", label: "Late, half day & absent" },
];

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
  const [cycleKey, setCycleKey] = useState(""); // the cycle the server is showing, as YYYY-MM
  const [currentKey, setCurrentKey] = useState(""); // the cycle that contains today
  const [today, setToday] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [days, setDays] = useState<CalendarDayRow[] | null>(null);
  const [summary, setSummary] = useState<CycleCounts>(EMPTY_CYCLE_COUNTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<AttendanceRow | null>(null);
  // Oldest first reads like a calendar: the start of the cycle at the top, the end at the bottom.
  const [newestFirst, setNewestFirst] = useState(false);
  const [view, setView] = useState<ListView>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      if (month) qs.set("month", month);
      if (canViewAll && employeeId) qs.set("employeeId", employeeId);
      const data = await api<{
        records: AttendanceRow[];
        days: CalendarDayRow[] | null;
        summary: CycleCounts;
        period?: { start: string; end: string };
        today?: string;
        month?: string;
      }>(`/api/attendance?${qs}`);
      setRecords(data.records);
      setDays(data.days ?? null);
      setSummary(data.summary ?? EMPTY_CYCLE_COUNTS);
      setPeriod(data.period ?? null);
      setToday(data.today ?? "");
      setCycleKey(data.month ?? month);
      if (!month && data.month) setCurrentKey(data.month);
    } catch (e) {
      setRecords([]);
      setDays(null);
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

  const goToCycle = (delta: number) => {
    const base = cycleKey || month;
    if (!base) return;
    const next = shiftMonth(base, delta);
    setMonth(next === currentKey ? "" : next);
  };

  // One employee: every calendar date of the cycle, with no gaps. Everyone: the stored records.
  const allItems: ListItem[] = days
    ? days.map((d) => ({
        key: d.date,
        date: d.date,
        employeeName: d.employeeName,
        employeeCode: d.employeeCode,
        record: d.record,
        kind: d.kind,
        label: d.label,
        note: d.note,
      }))
    : records.map((r) => ({
        key: r.id,
        date: r.workDate.slice(0, 10),
        employeeName: r.employeeName,
        employeeCode: r.employeeCode ?? null,
        record: r,
        kind: "record",
        label: "",
        note: "",
      }));

  const dir = newestFirst ? -1 : 1;
  const items = allItems
    .filter((it) => {
      if (view === "punched") return !!it.record;
      if (view === "issues") return (!!it.record && ["late", "half_day", "absent"].includes(it.record.status)) || it.kind === "absent";
      return true;
    })
    .sort((a, b) => (a.date < b.date ? -dir : a.date > b.date ? dir : a.employeeName.localeCompare(b.employeeName)));

  // The employee column only helps when several people share the list.
  const showEmployee = canViewAll && !days;
  const hasToday = items.some((it) => it.date === today);
  const isCurrentCycle = !month || month === currentKey;

  const jumpToToday = () => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-today="true"]'));
    const visible = rows.find((el) => el.offsetParent !== null);
    visible?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const emptyMessage =
    allItems.length === 0
      ? "No attendance records for the selected period."
      : view === "issues"
        ? "No late, half-day or absent days in this period."
        : "Nothing to show for this filter.";

  return (
    <div>
      <PageHeader title="Attendance" subtitle="Photo-verified punches with GPS geofencing" />

      <Card className="mb-4">
        <div className={`grid gap-4 ${canViewAll ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`}>
          <div>
            <span className="mb-1 block text-xs font-semibold text-slate-600">Salary cycle</span>
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => goToCycle(-1)}
                aria-label="Previous salary cycle"
                className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              >
                ‹
              </button>
              <div className="min-w-0 flex-1">
                <Input type="month" value={month || cycleKey} onChange={(v) => setMonth(v === currentKey ? "" : v)} />
              </div>
              <button
                type="button"
                onClick={() => goToCycle(1)}
                aria-label="Next salary cycle"
                className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              >
                ›
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              {period && (
                <p className="text-xs text-slate-500">
                  {formatDayKey(period.start)} → {formatDayKey(period.end)}
                </p>
              )}
              {!isCurrentCycle && (
                <button type="button" onClick={() => setMonth("")} className="text-xs font-semibold text-indigo-600 hover:underline">
                  Back to current cycle
                </button>
              )}
            </div>
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
      ) : (
        <>
          {/* Same tiles and same numbers as the Home page (payroll's own counts for this cycle). */}
          <div className="mb-4 grid grid-cols-5 gap-1.5 sm:gap-2">
            {[
              { label: "On time", value: summary.present, cls: "bg-emerald-50 text-emerald-700" },
              { label: "Late", value: summary.late, cls: "bg-amber-50 text-amber-700" },
              { label: "Half day", value: summary.half, cls: "bg-orange-50 text-orange-700" },
              { label: "Absent", value: summary.absent, cls: "bg-rose-50 text-rose-700" },
              { label: "Leaves", value: summary.leave, cls: "bg-sky-50 text-sky-700" },
            ].map((s) => (
              <div key={s.label} className={`rounded-xl px-1 py-2.5 text-center ${s.cls}`}>
                <p className="text-lg font-bold tabular-nums">{s.value}</p>
                <p className="text-[10px] font-bold leading-tight sm:text-[11px]">{s.label}</p>
              </div>
            ))}
          </div>

          {/* List controls */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {LIST_VIEWS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setView(v.key)}
                  aria-pressed={view === v.key}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                    view === v.key ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {hasToday && (
                <button type="button" onClick={jumpToToday} className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100">
                  Jump to today
                </button>
              )}
              <button
                type="button"
                onClick={() => setNewestFirst((v) => !v)}
                className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                title="Change the order of the list"
              >
                ⇅ {newestFirst ? "Newest first" : "Oldest first"}
              </button>
            </div>
          </div>

          {items.length === 0 ? (
            <EmptyState message={emptyMessage} />
          ) : (
            <>
              {/* Laptop table */}
              <Card className="hidden overflow-x-auto p-0 lg:block">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Date</th>
                      {showEmployee && <th className="px-4 py-3 font-semibold">Employee</th>}
                      <th className="whitespace-nowrap px-4 py-3 font-semibold">Punch in</th>
                      <th className="whitespace-nowrap px-4 py-3 font-semibold">Punch out</th>
                      <th className="px-4 py-3 font-semibold">Hours</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Photos</th>
                      {canManage && <th className="px-4 py-3 font-semibold">Action</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {items.map((it) => {
                      const r = it.record;
                      const isToday = it.date === today;
                      return (
                        <tr
                          key={it.key}
                          data-today={isToday ? "true" : undefined}
                          className={`scroll-mt-24 hover:bg-slate-50/60 ${it.kind === "upcoming" ? "text-slate-400" : ""} ${isToday ? "bg-indigo-50/60" : ""}`}
                        >
                          <td className="whitespace-nowrap px-4 py-3">
                            <p className="font-semibold text-slate-700">
                              {formatDayKey(it.date)}
                              {isToday && <span className="ml-1.5 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">TODAY</span>}
                              {r?.isManual && <span className="ml-1.5 text-[10px] font-bold text-indigo-500">EDITED</span>}
                            </p>
                            <p className="text-[11px] text-slate-400">{weekdayOf(it.date)}</p>
                          </td>
                          {showEmployee && (
                            <td className="px-4 py-3">
                              <p className="font-medium text-slate-700">{it.employeeName}</p>
                              {it.employeeCode && <p className="font-mono text-[11px] text-slate-400">{it.employeeCode}</p>}
                            </td>
                          )}
                          <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r ? formatTime(r.punchInTime) : "—"}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r ? <>{formatTime(r.punchOutTime)}<TimeNotes r={r} /></> : "—"}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-600">{r ? workingHours(r.punchInTime, r.punchOutTime) : "—"}</td>
                          <td className="px-4 py-3">
                            <span className="whitespace-nowrap"><StatusBadge item={it} /></span>
                            {!r && it.note && <p className="mt-1 text-[11px] text-slate-400">{it.note}</p>}
                            {!r && isAdmin && it.kind === "absent" && (
                              <Link href="/rules#rule-paid-holidays" className="mt-1 block text-[11px] font-semibold text-indigo-600 hover:underline">Not a working day? Make it a paid holiday</Link>
                            )}
                          </td>
                          <td className="px-4 py-3">{r ? <Photos record={r} allowed={canSeePhotos} /> : <span className="text-xs text-slate-300">—</span>}</td>
                          {canManage && (
                            <td className="px-4 py-3">
                              {r && <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>Edit</Button>}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>

              {/* Phone and tablet cards */}
              <div className="space-y-3 lg:hidden">
                {items.map((it) => {
                  const r = it.record;
                  const isToday = it.date === today;
                  return (
                    <div
                      key={it.key}
                      data-today={isToday ? "true" : undefined}
                      className={`scroll-mt-32 rounded-2xl border bg-white p-4 shadow-sm ${isToday ? "border-indigo-300 ring-2 ring-indigo-100" : "border-slate-200"} ${it.kind === "upcoming" ? "opacity-60" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-800">
                            {formatDayKey(it.date)}
                            {isToday && <span className="ml-2 rounded bg-indigo-600 px-1.5 py-0.5 align-middle text-[10px] font-bold text-white">TODAY</span>}
                          </p>
                          <p className="text-[11px] text-slate-400">{weekdayOf(it.date)}{it.note && !r ? ` · ${it.note}` : ""}</p>
                          {!r && isAdmin && it.kind === "absent" && (
                            <Link href="/rules#rule-paid-holidays" className="mt-0.5 block text-[11px] font-semibold text-indigo-600 hover:underline">Not a working day? Make it a paid holiday</Link>
                          )}
                          {showEmployee && <p className="text-xs text-slate-500">{it.employeeName}{it.employeeCode ? ` · ${it.employeeCode}` : ""}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {r?.isManual && <span className="text-[10px] font-bold text-indigo-500">EDITED</span>}
                          <StatusBadge item={it} />
                        </div>
                      </div>
                      {r && (
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
                      )}
                      {r && (
                        <div className="mt-3 flex items-center justify-between">
                          <Photos record={r} allowed={canSeePhotos} />
                          {canManage && (
                            <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>Edit</Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
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
