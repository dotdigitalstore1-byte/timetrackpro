"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, downloadBlob, hasPower, useMe } from "@/lib/client";
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, Modal, PageHeader, Select, Spinner } from "@/components/ui";
import EmployeePicker from "@/components/EmployeePicker";
import { formatDayKey, formatTime } from "@/lib/utils";

interface PhotoRecord {
  employeeCode?: string | null;
  id: string;
  employeeId: string;
  employeeName: string;
  departments: string;
  workDate: string;
  punchInTime: string | null;
  punchOutTime: string | null;
  status: string;
  autoHalfDay: boolean;
  hasPunchInPhoto: boolean;
  hasPunchOutPhoto: boolean;
}

interface Option {
  code?: string | null;
  id: string;
  name: string;
}

interface Selected {
  record: PhotoRecord;
  which: "in" | "out";
}

const STATUS_TONE: Record<string, "green" | "amber" | "red" | "slate"> = {
  present: "green",
  late: "amber",
  half_day: "red",
  absent: "red",
  on_leave: "slate",
};

function photoUrl(id: string, which: "in" | "out") {
  return `/api/attendance/${id}/photo?which=${which}`;
}

function query(params: Record<string, string>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  return qs.toString();
}

/** Salary-cycle month input: the cycle is named after the month it ends in. Empty = the current cycle. */
export default function PhotoAuditPage() {
  const { me, loading: meLoading } = useMe();
  const isAdmin = hasPower(me, "view_photos");

  const [month, setMonth] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [employees, setEmployees] = useState<Option[]>([]);
  const [departments, setDepartments] = useState<Option[]>([]);

  const [records, setRecords] = useState<PhotoRecord[]>([]);
  const [period, setPeriod] = useState<{ start: string; end: string } | null>(null);
  const [retentionDays, setRetentionDays] = useState(45);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [selected, setSelected] = useState<Selected | null>(null);

  const filters = useMemo(() => ({ month, employeeId, departmentId }), [month, employeeId, departmentId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api<{ records: PhotoRecord[]; period: { start: string; end: string }; retentionDays: number }>(
        `/api/attendance/photos?${query({ ...filters, photos: "1" })}`
      );
      setRecords(data.records.filter((r) => r.hasPunchInPhoto || r.hasPunchOutPhoto));
      setPeriod(data.period);
      setRetentionDays(data.retentionDays);
    } catch (e) {
      setRecords([]);
      setError(e instanceof Error ? e.message : "Could not load photos");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (isAdmin) void load();
    else if (!meLoading) setLoading(false);
  }, [isAdmin, meLoading, load]);

  useEffect(() => {
    if (!isAdmin) return;
    void (async () => {
      try {
        const [e, d] = await Promise.all([
          api<{ employees: { id: string; fullName: string; employeeCode: string | null }[] }>("/api/employees"),
          api<{ departments: { id: string; name: string }[] }>("/api/departments"),
        ]);
        setEmployees(e.employees.map((x) => ({ id: x.id, name: x.fullName, code: x.employeeCode })));
        setDepartments(d.departments.map((x) => ({ id: x.id, name: x.name })));
      } catch {
        // filters are optional; the gallery still works without them
      }
    })();
  }, [isAdmin]);

  // Downloads go through fetch so an error (e.g. "too many records") is shown instead of a broken file.
  const exportFile = async (withPhotos: boolean) => {
    setDownloading(true);
    setError("");
    try {
      const qs = query({ ...filters, format: "xlsx", photos: withPhotos ? "1" : "0" });
      const res = await fetch(`/api/attendance/photos?${qs}`, { credentials: "same-origin" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(body?.error || "Download failed", res.status);
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") || "";
      const name = cd.match(/filename="([^"]+)"/)?.[1] || "attendance.xlsx";
      downloadBlob(blob, name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  // Group the photos by date, newest first.
  const groups = useMemo(() => {
    const map = new Map<string, PhotoRecord[]>();
    for (const r of records) {
      const list = map.get(r.workDate) ?? [];
      list.push(r);
      map.set(r.workDate, list);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [records]);

  if (meLoading) return <div className="flex justify-center py-16"><Spinner /></div>;
  if (!isAdmin) return <EmptyState message="You do not have permission to review punch photos." />;

  return (
    <div>
      <PageHeader
        title="Photo audit"
        subtitle={`Review punch photos by salary cycle. Photos are kept for ${retentionDays} days and then deleted automatically, so download anything you need to keep.`}
      />

      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Input label="Salary cycle" type="month" value={month} onChange={setMonth} />
            <p className="mt-1 text-[11px] text-slate-400">
              Named after the month it ends in (e.g. November = 26 Oct – 25 Nov). Leave empty for the current cycle.
            </p>
          </div>
          <EmployeePicker
            label="Employee"
            value={employeeId}
            onChange={setEmployeeId}
            allLabel="All employees"
            items={employees.map((e) => ({ id: e.id, name: e.name, code: e.code }))}
          />
          <Select
            label="Department"
            value={departmentId}
            onChange={setDepartmentId}
            options={[{ value: "", label: "All departments" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
          />
          <div className="flex flex-col justify-end gap-2">
            <Button variant="secondary" className="w-full" onClick={() => exportFile(false)} loading={downloading}>
              Download Excel (data only)
            </Button>
            <Button className="w-full" onClick={() => exportFile(true)} loading={downloading}>
              Download Excel with photos
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {period && <span>Showing {formatDayKey(period.start)} → {formatDayKey(period.end)}</span>}
          <span>·</span>
          <span>{records.length} day{records.length === 1 ? "" : "s"} with photos</span>
          <span>·</span>
          <span>Photo exports are limited to 400 records at a time; narrow the filters for larger ranges.</span>
        </div>
      </Card>

      {error && <div className="mb-4"><ErrorBanner message={error} onRetry={load} /></div>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : groups.length === 0 ? (
        <EmptyState message="No punch photos for this cycle and filter." />
      ) : (
        <div className="space-y-6">
          {groups.map(([day, list]) => (
            <section key={day}>
              <h3 className="mb-2 text-sm font-bold text-slate-700">{formatDayKey(day)}</h3>
              {/* 2 large photos per row on phones, 3 on larger screens */}
              <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">
                {list.map((r) => (
                  <Card key={r.id} className="p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{r.employeeName}{r.employeeCode ? <span className="ml-1.5 font-mono text-[11px] font-normal text-slate-400">{r.employeeCode}</span> : null}</p>
                        <p className="truncate text-[11px] text-slate-400">{r.departments || "No department"}</p>
                      </div>
                      <Badge tone={STATUS_TONE[r.status] ?? "slate"}>{r.status.replace("_", " ")}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {(["in", "out"] as const).map((which) => {
                        const has = which === "in" ? r.hasPunchInPhoto : r.hasPunchOutPhoto;
                        const time = which === "in" ? r.punchInTime : r.punchOutTime;
                        return (
                          <button
                            key={which}
                            type="button"
                            disabled={!has}
                            onClick={() => setSelected({ record: r, which })}
                            className="group relative overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200 disabled:opacity-60"
                            aria-label={`${which === "in" ? "Punch-in" : "Punch-out"} photo for ${r.employeeName}`}
                          >
                            {has ? (
                              <img
                                src={photoUrl(r.id, which)}
                                alt=""
                                loading="lazy"
                                className="aspect-[3/4] w-full object-cover transition group-hover:scale-[1.02]"
                              />
                            ) : (
                              <div className="flex aspect-[3/4] items-center justify-center text-xs text-slate-400">No photo</div>
                            )}
                            <span className="absolute bottom-1 left-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              {which === "in" ? "IN" : "OUT"} {time ? formatTime(time) : "—"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {r.autoHalfDay && (
                      <p className="mt-2 text-[11px] font-medium text-rose-600">No punch-out recorded: counted as a half day.</p>
                    )}
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.record.employeeName} · ${formatDayKey(selected.record.workDate)}` : ""}
      >
        {selected && (
          <div className="space-y-3">
            <div className="flex gap-2">
              {(["in", "out"] as const).map((w) => {
                const has = w === "in" ? selected.record.hasPunchInPhoto : selected.record.hasPunchOutPhoto;
                if (!has) return null;
                return (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setSelected({ ...selected, which: w })}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      selected.which === w ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {w === "in" ? "Punch in" : "Punch out"}
                  </button>
                );
              })}
            </div>
            <img
              src={photoUrl(selected.record.id, selected.which)}
              alt={`${selected.which === "in" ? "Punch-in" : "Punch-out"} photo`}
              className="mx-auto max-h-[70dvh] w-auto max-w-full rounded-xl object-contain"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                {selected.which === "in" ? "Punched in" : "Punched out"}{" "}
                {(selected.which === "in" ? selected.record.punchInTime : selected.record.punchOutTime)
                  ? formatTime(selected.which === "in" ? selected.record.punchInTime : selected.record.punchOutTime)
                  : "—"}
              </span>
              <a
                href={photoUrl(selected.record.id, selected.which)}
                download={`${selected.record.employeeName.replace(/\s+/g, "-")}-${selected.record.workDate}-${selected.which}.jpg`}
                className="inline-flex items-center rounded-lg bg-indigo-600 px-3 py-2 font-semibold text-white hover:bg-indigo-700"
              >
                Download this photo
              </a>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
