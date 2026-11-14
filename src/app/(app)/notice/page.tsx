"use client";

import { useCallback, useEffect, useState } from "react";
import { api, useMe } from "@/lib/client";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Spinner, Textarea } from "@/components/ui";
import { formatDayKey, formatDate } from "@/lib/utils";
import { addDayKey, isDayKey, lastWorkingDayOf, signatureMatches } from "@/lib/notice";

interface NoticeView {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  status: "requested" | "active" | "rejected" | "cancelled" | "completed";
  source: "employee" | "admin";
  reason: string | null;
  resignationConfirmed: boolean;
  signedName: string | null;
  signedAt: string | null;
  requestedAt: string;
  startDate: string | null;
  noticeDays: number | null;
  lastWorkingDay: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  completedAt: string | null;
  phase: "upcoming" | "serving" | "ended" | null;
  daysLeft: number | null;
}

interface Policy {
  enabled: boolean;
  defaultDays: number;
  maxDays: number;
  allowEarlyRelease: boolean;
}

interface NoticeData {
  role: "employee" | "company_admin";
  todayKey: string;
  policy: Policy;
  // employee
  signerName?: string;
  current?: NoticeView | null;
  history?: NoticeView[];
  canRequest?: boolean;
  // admin
  requests?: NoticeView[];
  active?: NoticeView[];
  staff?: { id: string; name: string; code: string | null; onNotice: boolean }[];
}

const STATUS_TONE: Record<NoticeView["status"], "amber" | "indigo" | "red" | "slate" | "green"> = {
  requested: "amber",
  active: "indigo",
  rejected: "red",
  cancelled: "slate",
  completed: "green",
};

const STATUS_LABEL: Record<NoticeView["status"], string> = {
  requested: "Waiting for approval",
  active: "Notice in progress",
  rejected: "Declined",
  cancelled: "Cancelled",
  completed: "Completed",
};

function phaseText(n: NoticeView): string {
  if (n.status === "completed") return `Completed ${n.completedAt ? formatDate(n.completedAt) : ""}`.trim();
  if (n.phase === "upcoming") return `Starts ${formatDayKey(n.startDate)}`;
  if (n.phase === "serving") return `${n.daysLeft} day${n.daysLeft === 1 ? "" : "s"} left`;
  if (n.phase === "ended") return "Notice period has ended";
  return STATUS_LABEL[n.status];
}

export default function NoticePage() {
  const { me, loading: meLoading } = useMe();
  const [data, setData] = useState<NoticeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setData(await api<NoticeData>("/api/notice"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load notice periods");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (meLoading && !me) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Notice period"
        subtitle={
          data?.role === "company_admin"
            ? "Set the policy, approve requests and track people who are serving notice."
            : "Resign formally here. Your admin confirms the number of days."
        }
      />
      {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
      {loading && !data ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : data?.role === "company_admin" ? (
        <AdminNotice data={data} onChanged={load} />
      ) : data ? (
        <EmployeeNotice data={data} onChanged={load} />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ employee

function EmployeeNotice({ data, onChanged }: { data: NoticeData; onChanged: () => Promise<void> }) {
  const policy = data.policy;
  const current = data.current ?? null;
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [signature, setSignature] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");

  const signerName = data.signerName ?? "";
  const signatureOk = signatureMatches(signature, signerName);

  const submit = async () => {
    setFormError("");
    setMessage("");
    if (!confirmed) {
      setFormError("Tick the box to confirm you have sent your formal resignation email.");
      return;
    }
    if (!signatureOk) {
      setFormError(`Type your full name exactly as it is on your account (${signerName}) to sign.`);
      return;
    }
    setBusy(true);
    try {
      await api("/api/notice", { method: "POST", body: JSON.stringify({ action: "request", reason, confirmed, signature }) });
      setReason("");
      setConfirmed(false);
      setSignature("");
      setMessage("Request sent. Your admin will review it and confirm your notice period.");
      await onChanged();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not send the request");
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!current || !window.confirm("Withdraw your notice request?")) return;
    setBusy(true);
    try {
      await api("/api/notice", { method: "POST", body: JSON.stringify({ action: "withdraw", noticeId: current.id }) });
      setMessage("Request withdrawn.");
      await onChanged();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not withdraw the request");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="min-w-0 space-y-5 lg:col-span-2">
        {current && (
          <Card className={current.status === "active" ? "border-indigo-200 bg-indigo-50/50" : "border-amber-200 bg-amber-50/50"}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Your notice</p>
                <p className="mt-1 text-xl font-bold text-slate-900">{STATUS_LABEL[current.status]}</p>
                <p className="mt-0.5 text-sm text-slate-600">{phaseText(current)}</p>
              </div>
              <Badge tone={STATUS_TONE[current.status]}>{current.status === "active" ? "Active" : "Pending"}</Badge>
            </div>

            {current.status === "active" && (
              <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Detail label="First day" value={formatDayKey(current.startDate)} />
                <Detail label="Last working day" value={formatDayKey(current.lastWorkingDay)} />
                <Detail label="Notice length" value={current.noticeDays ? `${current.noticeDays} days` : "—"} />
              </dl>
            )}
            {current.status === "active" && (
              <p className="mt-4 text-sm text-slate-600">
                Please keep working as normal until your last working day. Punching in and out continues as usual.
              </p>
            )}
            {current.status === "requested" && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-600">Sent {formatDate(current.requestedAt)}. You can withdraw it while it is waiting.</p>
                <Button variant="secondary" size="sm" onClick={withdraw} loading={busy}>
                  Withdraw request
                </Button>
              </div>
            )}
            {current.decisionNote && current.status === "active" && (
              <p className="mt-4 rounded-lg bg-white/70 px-3 py-2 text-xs text-slate-600">Note from admin: {current.decisionNote}</p>
            )}
          </Card>
        )}

        {!current && !policy.enabled && (
          <EmptyState message="Notice period requests are switched off for your company. Please speak to your admin." />
        )}

        {!current && policy.enabled && (
          <Card className="p-5 sm:p-6">
            <h2 className="font-bold text-slate-900">Request a notice period</h2>
            <p className="mt-1 text-sm text-slate-500">
              Send your formal resignation first, then submit this form. Your standard notice is{" "}
              <span className="font-semibold text-slate-700">{policy.defaultDays} days</span>. Your admin sets the exact number of days when they approve.
            </p>

            <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
              <li>Email your resignation to your manager and HR.</li>
              <li>Come back here, confirm it, and sign with your name.</li>
              <li>Your admin reviews the request and sets your last working day.</li>
            </ol>

            <div className="mt-5 space-y-4">
              <Textarea
                label="Reason (optional)"
                value={reason}
                onChange={setReason}
                rows={3}
                placeholder="For example: new opportunity, relocation, further studies"
              />

              <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-200">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-indigo-600"
                />
                <span className="text-sm text-slate-700">
                  I have sent my formal resignation email to my manager and HR, and I have a copy of it.
                </span>
              </label>

              <div>
                <Input
                  label="Digital signature"
                  value={signature}
                  onChange={setSignature}
                  placeholder={signerName || "Your full name"}
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Type your full name exactly as on your account
                  {signerName ? <> (<span className="font-semibold text-slate-600">{signerName}</span>)</> : null}. Your signature is recorded with the time of the request.
                </p>
                {signature && !signatureOk && <p className="mt-1 text-xs font-medium text-amber-700">The name does not match yet.</p>}
              </div>

              {formError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{formError}</p>}
              {message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{message}</p>}

              <Button size="lg" className="w-full" onClick={submit} loading={busy} disabled={!confirmed || !signatureOk}>
                Submit notice request
              </Button>
            </div>
          </Card>
        )}
      </div>

      <Card className="h-fit p-5">
        <h3 className="font-bold text-slate-900">History</h3>
        {(data.history ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No notice requests yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {(data.history ?? []).map((h) => (
              <li key={h.id} className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-800">{STATUS_LABEL[h.status]}</span>
                  <Badge tone={STATUS_TONE[h.status]}>{h.status}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {h.source === "admin" ? "Placed by admin" : "Requested"} {formatDate(h.requestedAt)}
                  {h.lastWorkingDay ? ` · Last day ${formatDayKey(h.lastWorkingDay)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200">
      <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-bold text-slate-900">{value}</dd>
    </div>
  );
}

// ------------------------------------------------------------------ admin

function AdminNotice({ data, onChanged }: { data: NoticeData; onChanged: () => Promise<void> }) {
  return (
    <div className="space-y-5">
      <PolicyCard policy={data.policy} onSaved={onChanged} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="font-bold text-slate-900">Requests to decide</h3>
          <p className="mb-3 text-xs text-slate-500">Approve to start the notice, and set the exact number of days.</p>
          {(data.requests ?? []).length === 0 ? (
            <EmptyState message="No requests waiting." />
          ) : (
            <div className="space-y-3">
              {(data.requests ?? []).map((r) => (
                <RequestRow key={r.id} notice={r} policy={data.policy} todayKey={data.todayKey} onDone={onChanged} />
              ))}
            </div>
          )}
        </Card>

        <PlaceCard data={data} onDone={onChanged} />
      </div>

      <Card className="p-5">
        <h3 className="font-bold text-slate-900">People serving notice</h3>
        {(data.active ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Nobody is on notice right now.</p>
        ) : (
          <div className="mt-3 divide-y divide-slate-100">
            {(data.active ?? []).map((n) => (
              <ActiveRow key={n.id} notice={n} onDone={onChanged} />
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="font-bold text-slate-900">History</h3>
        {(data.history ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No closed notice periods yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3">Employee</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Days</th>
                  <th className="py-2 pr-3">Last working day</th>
                  <th className="py-2">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data.history ?? []).map((h) => (
                  <tr key={h.id}>
                    <td className="py-2.5 pr-3 font-semibold text-slate-800">
                      {h.employeeName}
                      {h.employeeCode && <span className="ml-1 text-xs font-normal text-slate-400">{h.employeeCode}</span>}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge tone={STATUS_TONE[h.status]}>{h.status}</Badge>
                    </td>
                    <td className="py-2.5 pr-3 text-slate-600">{h.noticeDays ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-slate-600">{formatDayKey(h.lastWorkingDay)}</td>
                    <td className="py-2.5 text-slate-500">{h.source === "admin" ? "Admin" : "Employee"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function PolicyCard({ policy, onSaved }: { policy: Policy; onSaved: () => Promise<void> }) {
  const [enabled, setEnabled] = useState(policy.enabled);
  const [defaultDays, setDefaultDays] = useState(String(policy.defaultDays));
  const [maxDays, setMaxDays] = useState(String(policy.maxDays));
  const [early, setEarly] = useState(policy.allowEarlyRelease);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setEnabled(policy.enabled);
    setDefaultDays(String(policy.defaultDays));
    setMaxDays(String(policy.maxDays));
    setEarly(policy.allowEarlyRelease);
  }, [policy]);

  const save = async () => {
    setMessage("");
    setError("");
    const d = Number(defaultDays);
    const m = Number(maxDays);
    if (!Number.isInteger(d) || d < 1 || !Number.isInteger(m) || m < 1) {
      setError("Days must be whole numbers, at least 1.");
      return;
    }
    if (d > m) {
      setError("The standard notice cannot be longer than the maximum.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          settings: { noticeEnabled: enabled, noticeDefaultDays: d, noticeMaxDays: m, noticeAllowEarlyRelease: early },
        }),
      });
      setMessage("Notice policy saved.");
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the policy");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-900">Notice policy</h3>
          <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
            These are the standard rules. You still set the exact days for each person when you approve them.
            Salary during notice follows the existing salary-hold rule under Rules, so unapproved absences still delay pay.
          </p>
        </div>
        <Badge tone={enabled ? "green" : "slate"}>{enabled ? "Employees can request" : "Requests off"}</Badge>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Input label="Standard notice (days)" type="number" min="1" value={defaultDays} onChange={setDefaultDays} />
        <Input label="Maximum notice (days)" type="number" min="1" value={maxDays} onChange={setMaxDays} />
        <div className="flex flex-col justify-end gap-2.5">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
            Employees can request a notice
          </label>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
            <input type="checkbox" checked={early} onChange={(e) => setEarly(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
            Allow shorter notice (early release)
          </label>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={save} loading={busy}>
          Save policy
        </Button>
        {message && <span className="text-sm font-medium text-emerald-700">{message}</span>}
        {error && <span className="text-sm font-medium text-rose-700">{error}</span>}
      </div>
    </Card>
  );
}

function RequestRow({
  notice,
  policy,
  todayKey,
  onDone,
}: {
  notice: NoticeView;
  policy: Policy;
  todayKey: string;
  onDone: () => Promise<void>;
}) {
  const [days, setDays] = useState(String(policy.defaultDays));
  const [start, setStart] = useState(todayKey);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"" | "approve" | "reject">("");
  const [error, setError] = useState("");

  const d = Number(days);
  const validDays = Number.isInteger(d) && d >= 1 && d <= policy.maxDays;
  const preview = validDays && isDayKey(start) ? lastWorkingDayOf(start, d) : null;

  const act = async (action: "approve" | "reject") => {
    setError("");
    if (action === "approve") {
      if (!validDays) {
        setError(`Enter a whole number of days from 1 to ${policy.maxDays}.`);
        return;
      }
      if (!isDayKey(start)) {
        setError("Choose a valid start date.");
        return;
      }
    }
    setBusy(action);
    try {
      await api("/api/notice", {
        method: "POST",
        body: JSON.stringify({ action, noticeId: notice.id, days: d, startDate: start, note }),
      });
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-slate-900">
            {notice.employeeName} {notice.employeeCode && <span className="text-xs font-normal text-slate-400">{notice.employeeCode}</span>}
          </p>
          <p className="text-xs text-slate-500">Requested {formatDate(notice.requestedAt)}</p>
        </div>
        <Badge tone="amber">Waiting</Badge>
      </div>

      <div className="mt-3 space-y-1.5 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
        <p>
          <span className="font-semibold">Resignation email confirmed:</span> {notice.resignationConfirmed ? "Yes" : "No"}
        </p>
        <p>
          <span className="font-semibold">Signed:</span> {notice.signedName ?? "—"}
          {notice.signedAt ? ` · ${formatDate(notice.signedAt)}` : ""}
        </p>
        {notice.reason && (
          <p>
            <span className="font-semibold">Reason:</span> {notice.reason}
          </p>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <Input label="Days to serve" type="number" min="1" max={String(policy.maxDays)} value={days} onChange={setDays} />
        <Input label="First day of notice" type="date" value={start} onChange={setStart} />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Last working day: <span className="font-semibold text-slate-700">{preview ? formatDayKey(preview) : "—"}</span>
      </p>
      <Input label="Note to employee (optional)" value={note} onChange={setNote} className="mt-2" />

      {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="success" onClick={() => act("approve")} loading={busy === "approve"} disabled={!!busy}>
          Approve
        </Button>
        <Button size="sm" variant="secondary" onClick={() => act("reject")} loading={busy === "reject"} disabled={!!busy}>
          Decline
        </Button>
      </div>
    </div>
  );
}

function PlaceCard({ data, onDone }: { data: NoticeData; onDone: () => Promise<void> }) {
  const staff = data.staff ?? [];
  const [employeeId, setEmployeeId] = useState("");
  const [days, setDays] = useState(String(data.policy.defaultDays));
  const [start, setStart] = useState(data.todayKey);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const d = Number(days);
  const validDays = Number.isInteger(d) && d >= 1 && d <= data.policy.maxDays;

  const place = async () => {
    setMessage("");
    setError("");
    if (!employeeId) {
      setError("Choose an employee.");
      return;
    }
    if (!validDays) {
      setError(`Enter a whole number of days from 1 to ${data.policy.maxDays}.`);
      return;
    }
    if (!isDayKey(start)) {
      setError("Choose a valid start date.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/notice", { method: "POST", body: JSON.stringify({ action: "place", employeeId, days: d, startDate: start, reason }) });
      setMessage("Employee placed on notice.");
      setEmployeeId("");
      setReason("");
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not place the employee on notice");
    } finally {
      setBusy(false);
    }
  };

  const previewEnd = validDays && isDayKey(start) ? addDayKey(start, d - 1) : null;

  return (
    <Card className="p-5">
      <h3 className="font-bold text-slate-900">Place someone on notice</h3>
      <p className="mb-3 text-xs text-slate-500">Use this when the company, not the employee, starts the notice.</p>

      {staff.length === 0 ? (
        <EmptyState message="No active employees yet." />
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Employee</span>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            >
              <option value="">Choose an employee…</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id} disabled={s.onNotice}>
                  {s.name}
                  {s.code ? ` (${s.code})` : ""}
                  {s.onNotice ? " — already on notice" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2.5">
            <Input label="Days to serve" type="number" min="1" max={String(data.policy.maxDays)} value={days} onChange={setDays} />
            <Input label="First day of notice" type="date" value={start} onChange={setStart} />
          </div>
          <p className="text-xs text-slate-500">
            Last working day: <span className="font-semibold text-slate-700">{previewEnd ? formatDayKey(previewEnd) : "—"}</span>
          </p>
          <Textarea label="Reason (optional)" value={reason} onChange={setReason} rows={2} />

          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p>}
          {message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{message}</p>}

          <Button onClick={place} loading={busy} disabled={!employeeId} className="w-full">
            Place on notice
          </Button>
        </div>
      )}
    </Card>
  );
}

function ActiveRow({ notice, onDone }: { notice: NoticeView; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const act = async (action: "complete" | "cancel") => {
    const question =
      action === "complete"
        ? `Mark ${notice.employeeName}'s notice as completed?`
        : `Cancel ${notice.employeeName}'s notice period?`;
    if (!window.confirm(question)) return;
    setBusy(action);
    setError("");
    try {
      await api("/api/notice", { method: "POST", body: JSON.stringify({ action, noticeId: notice.id }) });
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the notice");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-semibold text-slate-900">
          {notice.employeeName} {notice.employeeCode && <span className="text-xs font-normal text-slate-400">{notice.employeeCode}</span>}
        </p>
        <p className="text-xs text-slate-500">
          {notice.noticeDays ?? "—"} days · {formatDayKey(notice.startDate)} → {formatDayKey(notice.lastWorkingDay)}
          {notice.source === "admin" ? " · placed by admin" : ""}
        </p>
        <p className="mt-0.5 text-xs font-semibold text-indigo-700">{phaseText(notice)}</p>
        {error && <p className="mt-1 text-xs font-medium text-rose-700">{error}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="success" onClick={() => act("complete")} loading={busy === "complete"} disabled={!!busy}>
          Mark completed
        </Button>
        <Button size="sm" variant="secondary" onClick={() => act("cancel")} loading={busy === "cancel"} disabled={!!busy}>
          Cancel notice
        </Button>
      </div>
    </div>
  );
}
