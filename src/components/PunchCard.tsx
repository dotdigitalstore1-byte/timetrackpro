"use client";

import { useCallback, useEffect, useState } from "react";
import { api, capturePhoto, getCurrentPosition } from "@/lib/client";
import { Badge, Button, Card } from "@/components/ui";
import { formatTime, toDateKey, workingHours } from "@/lib/utils";

interface AttendanceRow {
  id: string;
  employeeId: string;
  employeeName: string;
  workDate: string;
  punchInTime: string | null;
  punchOutTime: string | null;
  hasPunchInPhoto: boolean;
  hasPunchOutPhoto: boolean;
  status: string;
  isManual: boolean;
  note: string | null;
}

export default function PunchCard({ onChanged }: { onChanged?: () => void }) {
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [punching, setPunching] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [todayKey, setTodayKey] = useState("");

  const load = useCallback(async () => {
    try {
      // The server decides what "today" is (company timezone), never the device clock.
      const data = await api<{ records: AttendanceRow[]; today: string }>(`/api/attendance`);
      setRecords(data.records);
      setTodayKey(data.today);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load attendance");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const todayRecord = records.find((r) => toDateKey(new Date(r.workDate)) === todayKey) || null;

  const doPunch = async (type: "in" | "out") => {
    setError("");
    setSuccess("");
    setPunching(true);
    try {
      const photo = await capturePhoto();
      const pos = await getCurrentPosition();
      await api("/api/attendance", {
        method: "POST",
        body: JSON.stringify({ type, photo, lat: pos.lat, lng: pos.lng }),
      });
      setSuccess(type === "in" ? "Punch-in recorded successfully." : "Punch-out recorded successfully.");
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Punch failed");
    } finally {
      setPunching(false);
    }
  };

  const statusTone = todayRecord?.status === "present" ? "green" : todayRecord?.status === "late" ? "amber" : todayRecord?.status === "half_day" ? "red" : "slate";

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-900">Today&apos;s Attendance</h3>
        {todayRecord ? (
          <Badge tone={statusTone as "green" | "amber" | "red" | "slate"}>{todayRecord.status.replace("_", " ")}</Badge>
        ) : (
          <Badge tone="slate">Not punched</Badge>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-50 p-3 text-center">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Punch In</p>
          <p className="mt-1 text-lg font-bold text-slate-900">{formatTime(todayRecord?.punchInTime)}</p>
          {todayRecord?.hasPunchInPhoto && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/attendance/${todayRecord.id}/photo?which=in`} alt="Punch in" className="mx-auto mt-2 h-14 w-14 rounded-lg object-cover ring-1 ring-slate-200" />
          )}
        </div>
        <div className="rounded-xl bg-slate-50 p-3 text-center">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Punch Out</p>
          <p className="mt-1 text-lg font-bold text-slate-900">{formatTime(todayRecord?.punchOutTime)}</p>
          {todayRecord?.hasPunchOutPhoto && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/attendance/${todayRecord.id}/photo?which=out`} alt="Punch out" className="mx-auto mt-2 h-14 w-14 rounded-lg object-cover ring-1 ring-slate-200" />
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-xl bg-indigo-50 px-4 py-3">
        <span className="text-xs font-semibold text-indigo-700">Working hours</span>
        <span className="text-lg font-bold text-indigo-800">{workingHours(todayRecord?.punchInTime, todayRecord?.punchOutTime)}</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Button
          variant="success"
          size="lg"
          disabled={!!todayRecord?.punchInTime}
          loading={punching}
          onClick={() => doPunch("in")}
          className="w-full"
        >
          {todayRecord?.punchInTime ? "✓ Punched In" : "📸 Punch In"}
        </Button>
        <Button
          variant="primary"
          size="lg"
          disabled={!todayRecord?.punchInTime || !!todayRecord?.punchOutTime}
          loading={punching}
          onClick={() => doPunch("out")}
          className="w-full"
        >
          {todayRecord?.punchOutTime ? "✓ Punched Out" : "📸 Punch Out"}
        </Button>
      </div>
      <p className="mt-2 text-center text-[11px] text-slate-400">Photo + GPS location are verified before punching.</p>

      {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
      {success && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{success}</p>}
      {loading && <p className="mt-3 text-center text-xs text-slate-400">Loading…</p>}
    </Card>
  );
}