"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { Badge, Button, Card } from "@/components/ui";
import { downloadPayslipPdf, type SlipPayload } from "@/lib/payslip-pdf";
import { formatDate, formatDayKey, monthLabel } from "@/lib/utils";

interface HistoryItem {
  id: string;
  month: number;
  year: number;
  periodStart: string | null;
  periodEnd: string | null;
  status: string;
}

interface EmployeeRequest {
  id: string;
  year: number;
  month: number;
  provisional?: boolean;
  status: "pending" | "approved" | "rejected";
  rejectionReason: string | null;
  availableUntil: string | null;
  available: boolean;
  expired: boolean;
}

interface AdminRequest {
  id: string;
  runningCycle?: boolean;
  employeeName: string;
  employeeCode: string | null;
  designation: string | null;
  year: number;
  month: number;
  requestedAt: string;
}

const cycleKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/** Employee view: request the slip of each finalized cycle, then download it while it is available. */
export function EmployeeSlipsCard({ history }: { history: HistoryItem[] }) {
  const [requests, setRequests] = useState<EmployeeRequest[]>([]);
  const [running, setRunning] = useState<{ year: number; month: number; midCycleAllowed: boolean } | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api<{ requests: EmployeeRequest[]; currentCycle?: { year: number; month: number; midCycleAllowed: boolean } }>("/api/salary/slips");
      setRequests(d.requests);
      setRunning(d.currentCycle ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load salary slip requests");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const finalized = history.filter((h) => h.status === "finalized" || h.status === "paid");
  // The cycle still running, shown only when the company allows slips for it. It is never a finalized cycle.
  const runningRow =
    running?.midCycleAllowed && !finalized.some((h) => h.year === running.year && h.month === running.month) ? running : null;
  const runningItem: HistoryItem | null = runningRow
    ? { id: "running", year: runningRow.year, month: runningRow.month, periodStart: null, periodEnd: null, status: "running" }
    : null;
  const requestFor = (h: HistoryItem) => requests.find((r) => r.year === h.year && r.month === h.month);

  const request = async (h: HistoryItem) => {
    setBusy(`req-${h.id}`);
    setMsg("");
    setErr("");
    try {
      await api("/api/salary/slips", { method: "POST", body: JSON.stringify({ action: "request", month: cycleKey(h.year, h.month) }) });
      setMsg("Request sent. Your admin will review it.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send the request");
    } finally {
      setBusy("");
    }
  };

  const download = async (r: EmployeeRequest) => {
    setBusy(`dl-${r.id}`);
    setMsg("");
    setErr("");
    try {
      const slip = await api<SlipPayload>(`/api/salary/slips/${r.id}`);
      await downloadPayslipPdf(slip);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not download the slip");
      await load();
    } finally {
      setBusy("");
    }
  };

  return (
    <Card>
      <h3 className="mb-1 font-bold text-slate-900">Salary slips</h3>
      <p className="mb-3 text-xs text-slate-500">
        Ask for a slip of a finalized cycle. After your admin approves it, you can download it for 90 days.
      </p>

      {finalized.length === 0 && !runningItem ? (
        <p className="text-sm text-slate-400">Slips are available once a salary cycle is finalized.</p>
      ) : (
        <div className="space-y-2">
          {runningItem && (() => {
            const h = runningItem;
            const r = requestFor(h);
            return (
              <div key="running" className="flex flex-col gap-2 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-700">{monthLabel(h.year, h.month)} · cycle in progress</p>
                  <p className="text-xs text-slate-500">A provisional slip, with figures up to the day your admin approves it.</p>
                  <SlipStatus r={r} />
                </div>
                <div className="shrink-0">
                  {!r && (
                    <Button size="sm" variant="secondary" loading={busy === `req-${h.id}`} onClick={() => request(h)}>
                      Request provisional slip
                    </Button>
                  )}
                  {r?.status === "rejected" && (
                    <Button size="sm" variant="secondary" loading={busy === `req-${h.id}`} onClick={() => request(h)}>
                      Request again
                    </Button>
                  )}
                  {r?.available && (
                    <Button size="sm" variant="success" loading={busy === `dl-${r.id}`} onClick={() => download(r)}>
                      Download PDF
                    </Button>
                  )}
                </div>
              </div>
            );
          })()}
          {finalized.map((h) => {
            const r = requestFor(h);
            const label = h.periodStart && h.periodEnd ? `${formatDayKey(h.periodStart)} – ${formatDayKey(h.periodEnd)}` : monthLabel(h.year, h.month);
            return (
              <div key={h.id} className="flex flex-col gap-2 rounded-xl bg-slate-50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-700">{label}</p>
                  <SlipStatus r={r} />
                </div>
                <div className="shrink-0">
                  {!r && (
                    <Button size="sm" variant="secondary" loading={busy === `req-${h.id}`} onClick={() => request(h)}>
                      Request slip
                    </Button>
                  )}
                  {r?.status === "rejected" && (
                    <Button size="sm" variant="secondary" loading={busy === `req-${h.id}`} onClick={() => request(h)}>
                      Request again
                    </Button>
                  )}
                  {r?.available && (
                    <Button size="sm" variant="success" loading={busy === `dl-${r.id}`} onClick={() => download(r)}>
                      Download PDF
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {msg && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{msg}</p>}
      {err && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{err}</p>}
    </Card>
  );
}

function SlipStatus({ r }: { r: EmployeeRequest | undefined }) {
  if (!r) return <p className="text-xs text-slate-400">No slip requested yet</p>;
  if (r.status === "pending") return <Badge tone="amber">Awaiting approval</Badge>;
  if (r.status === "rejected") {
    return (
      <div className="space-y-1">
        <Badge tone="red">Rejected</Badge>
        {r.rejectionReason && <p className="text-xs text-rose-600">{r.rejectionReason}</p>}
      </div>
    );
  }
  if (r.available) {
    return (
      <p className="text-xs text-emerald-700">
        Approved{r.provisional ? " (provisional)" : ""} · available until {r.availableUntil ? formatDate(r.availableUntil) : "—"}
      </p>
    );
  }
  return <Badge tone="slate">Download window ended (90 days)</Badge>;
}

/** Admin view: slip requests waiting for a decision. */
export function AdminSlipRequests() {
  const [items, setItems] = useState<AdminRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await api<{ requests: AdminRequest[] }>("/api/salary/slips?status=pending");
      setItems(d.requests);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load slip requests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (item: AdminRequest, action: "approve" | "reject") => {
    let reason = "";
    if (action === "approve") {
      const note = item.runningCycle
        ? " The cycle is still running, so the slip will be provisional, with figures up to today."
        : "";
      if (!window.confirm(`Approve the salary slip for ${item.employeeName}?${note} They can download it for 90 days.`)) return;
    } else {
      reason = window.prompt(`Reason for rejecting ${item.employeeName}'s request (shown to them, optional):`) ?? "";
      if (reason === null) return;
    }
    setBusy(item.id);
    setMsg("");
    setErr("");
    try {
      await api("/api/salary/slips", { method: "POST", body: JSON.stringify({ action, requestId: item.id, reason }) });
      setMsg(action === "approve" ? `Approved ${item.employeeName}'s slip.` : `Rejected ${item.employeeName}'s request.`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy("");
    }
  };

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-bold text-slate-900">Salary slip requests</h3>
        {items.length > 0 && <Badge tone="amber">{items.length} waiting</Badge>}
      </div>
      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-400">No slip requests are waiting for approval.</p>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="flex flex-col gap-2 rounded-xl bg-slate-50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">
                  {it.employeeName} {it.employeeCode && <span className="font-normal text-slate-400">· {it.employeeCode}</span>}
                  {it.runningCycle && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">Running cycle</span>}
                </p>
                <p className="text-xs text-slate-500">
                  Cycle {monthLabel(it.year, it.month)} · requested {formatDate(it.requestedAt)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="secondary" loading={busy === it.id} onClick={() => decide(it, "reject")}>Reject</Button>
                <Button size="sm" variant="success" loading={busy === it.id} onClick={() => decide(it, "approve")}>Approve</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {msg && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{msg}</p>}
      {err && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{err}</p>}
    </Card>
  );
}
