"use client";

import { useCallback, useEffect, useState } from "react";
import { api, useMe } from "@/lib/client";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Spinner } from "@/components/ui";
import { formatDate } from "@/lib/utils";

interface LeaveRow {
  id: string;
  employeeName: string;
  employeeId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: string;
  reason: string;
  status: string;
  level1Status: string;
  level2Status: string;
  currentLevel: number;
  rejectionReason: string | null;
}

export default function LeavesPage() {
  const { me } = useMe();
  const isAdmin = me?.user.role === "company_admin";
  const isManager = me?.user.role === "manager";
  const canApprove = isAdmin || isManager;

  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [balance, setBalance] = useState<{ year: number; quota: number; used: number; pending: number; remaining: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [success, setSuccess] = useState("");

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const data = await api<{ leaves: LeaveRow[]; balance: typeof balance }>("/api/leaves");
      setLeaves(data.leaves);
      setBalance(data.balance);
    } catch (e) {
      setLeaves([]);
      setLoadError(e instanceof Error ? e.message : "Could not load leave requests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const requestLeave = async () => {
    setError("");
    setSuccess("");
    try {
      await api("/api/leaves", {
        method: "POST",
        body: JSON.stringify({ startDate, endDate, reason }),
      });
      setSuccess("Leave request submitted.");
      setStartDate("");
      setEndDate("");
      setReason("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    }
  };

  const decide = async (id: string, action: "approve" | "reject" | "cancel") => {
    let reason = "";
    if (action === "reject") {
      reason = (window.prompt("Reason for rejecting this request (the employee will see it):") || "").trim();
      if (!reason) return;
    }
    setProcessing(id);
    try {
      await api(`/api/leaves/${id}`, { method: "PATCH", body: JSON.stringify({ action, reason }) });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Action failed");
    } finally {
      setProcessing("");
    }
  };

  return (
    <div>
      <PageHeader title="Leave Management" subtitle="Only leave requests — no other request categories" />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h3 className="mb-3 font-bold text-slate-900">Request Leave</h3>
          <div className="space-y-3">
            <Input label="Start date" type="date" value={startDate} onChange={setStartDate} />
            <Input label="End date" type="date" value={endDate} onChange={setEndDate} />
            <Input label="Reason" value={reason} onChange={setReason} placeholder="Why do you need leave?" />
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
            {success && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{success}</p>}
            <Button className="w-full" onClick={requestLeave} disabled={!startDate || !endDate}>Submit Request</Button>
            {balance && (
              <div className="rounded-xl bg-indigo-50 p-3 text-center">
                <p className="text-2xl font-bold text-indigo-700">{balance.remaining}</p>
                <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-500">
                  Leave days remaining ({balance.year})
                </p>
                <p className="mt-1 text-[11px] text-indigo-600">
                  Quota {balance.quota} · Approved {balance.used} · Pending {balance.pending}
                </p>
              </div>
            )}
            <p className="text-[11px] text-slate-400">
              Leave must be requested in advance. An absence without approved leave is an unapproved leave and puts part of your salary on hold.
            </p>
          </div>
        </Card>

        <div className="lg:col-span-2">
          <Card>
            <h3 className="mb-3 font-bold text-slate-900">Leave Requests</h3>
            {loadError && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{loadError}</p>}
            {loading ? (
              <div className="flex justify-center py-10"><Spinner /></div>
            ) : leaves.length === 0 ? (
              <EmptyState message="No leave requests yet." />
            ) : (
              <div className="space-y-3">
                {leaves.map((l) => (
                  <div key={l.id} className="rounded-xl border border-slate-100 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-bold text-slate-800">{l.employeeName}</p>
                        <p className="text-sm text-slate-500">
                          {formatDate(l.startDate)} → {formatDate(l.endDate)} · {l.days} day(s)
                        </p>
                        {l.reason && <p className="mt-1 text-sm text-slate-600">“{l.reason}”</p>}
                        {l.rejectionReason && <p className="mt-1 text-xs text-rose-500">Rejected: {l.rejectionReason}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          tone={l.status === "approved" ? "green" : l.status === "rejected" ? "red" : l.status === "cancelled" ? "slate" : "amber"}
                        >
                          {l.status}
                        </Badge>
                        {l.status === "pending" && l.currentLevel === 2 && <Badge tone="indigo">Level 2</Badge>}
                      </div>
                    </div>
                    {l.status === "pending" && l.employeeId === me?.employee?.id && (
                      <div className="mt-3">
                        <Button size="sm" variant="secondary" loading={processing === l.id} onClick={() => decide(l.id, "cancel")}>
                          Cancel request
                        </Button>
                      </div>
                    )}
                    {canApprove && l.status === "pending" && l.employeeId !== me?.employee?.id && (
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="success" loading={processing === l.id} onClick={() => decide(l.id, "approve")}>
                          Approve{l.currentLevel === 1 ? " (L1)" : ""}
                        </Button>
                        <Button size="sm" variant="danger" loading={processing === l.id} onClick={() => decide(l.id, "reject")}>
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {isManager && (
        <p className="mt-4 rounded-xl bg-sky-50 px-4 py-3 text-xs font-medium text-sky-700">
          Multi-level approval: managers approve Level 1, the company admin approves Level 2 (if enabled in Settings).
        </p>
      )}
    </div>
  );
}