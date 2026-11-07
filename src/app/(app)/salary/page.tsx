"use client";

import { useCallback, useEffect, useState } from "react";
import { api, hasPower, useMe } from "@/lib/client";
import { Badge, Button, Card, Input, PageHeader, Select, Spinner } from "@/components/ui";
import { formatDate, formatDayKey, formatNumber, monthLabel } from "@/lib/utils";

interface SalaryData {
  employee: { id: string; fullName: string; designation: string | null } | null;
  month: number;
  year: number;
  period: { start: string; end: string };
  cycles: { key: string; start: string; end: string }[];
  payDate: string;
  status: "preview" | "draft" | "finalized" | "paid";
  frozen: boolean;
  breakdown: {
    basicSalary: number;
    dailyRate: number;
    presentDays: number;
    absentDays: number;
    lateDays: number;
    halfDays: number;
    leaveDays: number;
    unapprovedLeaveCount: number;
    attendanceSalary: number;
    lateDeduction: number;
    earlyLeaveDays: number;
    earlyLeaveDeduction: number;
    overtimeMinutes: number;
    overtimePay: number;
    weekOffWorkedDays: number;
    compOffUsed: number;
    compOffUnused: number;
    unpaidLeaveDays: number;
    extraPayDays: number;
    extraPay: number;
    additions: { label: string; amount: number }[];
    additionsTotal: number;
    halfDayDeduction: number;
    leaveDeduction: number;
    otherDeductions: { label: string; amount: number }[];
    totalDeductions: number;
    salaryHoldDays: number;
    salaryHoldAmount: number;
    netBeforeHold: number;
    netPayable: number;
  };
  holds: { id: string | null; days: number; amount: number; reason: string; occurrenceDate: string; status: string }[];
  history: { id: string; month: number; year: number; periodStart: string | null; periodEnd: string | null; basicSalary: string; attendanceSalary: string; totalDeductions: string; salaryHoldAmount: string; netPayable: string; status: string }[];
}

const STATUS_TONE: Record<string, "slate" | "amber" | "indigo" | "green"> = {
  preview: "slate",
  draft: "amber",
  finalized: "indigo",
  paid: "green",
};

export default function SalaryPage() {
  const { me } = useMe();
  const isAdmin = me?.user.role === "company_admin";
  // Admins pick anyone; managers with the view_salary power pick people on their team (read only).
  const canPick = isAdmin || hasPower(me, "view_salary");
  const [cycleSummary, setCycleSummary] = useState<null | {
    label: string; activeEmployees: number; draft: number; finalized: number; paid: number; notCalculated: number; netPayable: string; totalDeductions: string;
  }>(null);
  const currency = me?.settings?.currency ?? "$";

  const [month, setMonth] = useState(""); // empty = server decides the current month in company timezone
  const [employeeId, setEmployeeId] = useState("");
  const [employees, setEmployees] = useState<{ id: string; fullName: string }[]>([]);
  const [data, setData] = useState<SalaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [loadError, setLoadError] = useState("");
  const [dLabel, setDLabel] = useState("");
  const [dAmount, setDAmount] = useState("");
  const [aLabel, setALabel] = useState("");
  const [aAmount, setAAmount] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const qs = new URLSearchParams();
      if (month) qs.set("month", month);
      if (canPick && employeeId) qs.set("employeeId", employeeId);
      const d = await api<SalaryData>(`/api/salary?${qs}`);
      setData(d);
      if (!month) setMonth(`${d.year}-${String(d.month).padStart(2, "0")}`);
    } catch (e) {
      setData(null);
      setLoadError(e instanceof Error ? e.message : "Could not load salary data");
    } finally {
      setLoading(false);
    }
  }, [month, employeeId, canPick]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (canPick && employees.length === 0) {
      api<{ employees: { id: string; fullName: string }[] }>("/api/employees")
        .then((d) => setEmployees(d.employees))
        .catch(() => setEmployees([]));
    }
  }, [canPick, employees.length]);

  // Company-wide progress for the cycle (admins only). Salary totals live here, not on the dashboard.
  useEffect(() => {
    if (!isAdmin) return;
    api<{ payroll?: NonNullable<typeof cycleSummary> }>("/api/dashboard")
      .then((d) => setCycleSummary(d.payroll ?? null))
      .catch(() => setCycleSummary(null));
  }, [isAdmin]);

  const act = async (action: string, extra: Record<string, unknown> = {}, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action);
    setMsg("");
    setErr("");
    try {
      const res = await api<{ finalized?: number; skipped?: number }>("/api/salary", {
        method: "POST",
        body: JSON.stringify({ action, month, employeeId: employeeId || undefined, ...extra }),
      });
      if (action === "finalize_all") setMsg(`Finalized ${res.finalized} salaries (${res.skipped} skipped).`);
      else setMsg("Done.");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy("");
    }
  };

  const b = data?.breakdown;
  const canEdit = isAdmin && !!employeeId && data && !data.frozen;

  return (
    <div>
      <PageHeader title="Salary" subtitle="Transparent attendance-based payroll — deductions and holds are tracked separately" />

      {isAdmin && cycleSummary && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-900">Payroll for this cycle</h3>
              <p className="text-xs text-slate-500">{cycleSummary.label}</p>
            </div>
            <p className="text-xs text-slate-500">
              {cycleSummary.activeEmployees} active employee{cycleSummary.activeEmployees === 1 ? "" : "s"}
            </p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-lg font-bold text-slate-700">{cycleSummary.notCalculated}</p><p className="text-[10px] font-bold uppercase text-slate-400">Not calculated</p></div>
            <div className="rounded-xl bg-amber-50 p-3 text-center"><p className="text-lg font-bold text-amber-700">{cycleSummary.draft}</p><p className="text-[10px] font-bold uppercase text-amber-600">Draft</p></div>
            <div className="rounded-xl bg-indigo-50 p-3 text-center"><p className="text-lg font-bold text-indigo-700">{cycleSummary.finalized}</p><p className="text-[10px] font-bold uppercase text-indigo-500">Finalised</p></div>
            <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="text-lg font-bold text-emerald-700">{cycleSummary.paid}</p><p className="text-[10px] font-bold uppercase text-emerald-600">Paid</p></div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <p className="rounded-xl bg-indigo-50 px-3 py-2 font-semibold text-indigo-700">Net payable: {currency}{formatNumber(cycleSummary.netPayable)}</p>
            <p className="rounded-xl bg-rose-50 px-3 py-2 font-semibold text-rose-700">Deductions: {currency}{formatNumber(cycleSummary.totalDeductions)}</p>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Totals cover finalised and paid salaries only. Drafts are not counted until finalised.</p>
        </Card>
      )}

      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Salary cycle"
            value={month || data?.cycles?.[0]?.key || ""}
            onChange={setMonth}
            options={(data?.cycles ?? []).map((c) => ({
              value: c.key,
              label: `${formatDayKey(c.start)} – ${formatDayKey(c.end)}${data?.cycles?.[0]?.key === c.key ? " (current)" : ""}`,
            }))}
          />
          {canPick && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Employee</span>
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500"
              >
                <option value="">Select employee…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.fullName}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {isAdmin && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" loading={busy === "finalize_all"} onClick={() => act("finalize_all", {}, "Finalize payroll for ALL active employees for this month? Finalized months cannot be recalculated.")}>
              Finalize whole month
            </Button>
            <span className="text-[11px] text-slate-400">Available once the salary cycle has ended.</span>
          </div>
        )}
        {msg && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{msg}</p>}
        {err && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{err}</p>}
      </Card>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : !data || !b ? (
        <Card>
          <p className={`text-center text-sm ${loadError ? "font-medium text-rose-600" : "text-slate-400"}`}>
            {loadError || `No salary data available. ${isAdmin ? "Select an employee." : "Check back later."}`}
          </p>
          {loadError && (
            <div className="mt-3 flex justify-center">
              <Button size="sm" variant="secondary" onClick={load}>Try again</Button>
            </div>
          )}
        </Card>
      ) : (
        <>
          <div className="mb-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 p-5 text-white">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm text-indigo-100">{data.employee?.fullName} · {data.employee?.designation || "Employee"} · {formatDayKey(data.period.start)} – {formatDayKey(data.period.end)}</p>
              <Badge tone={STATUS_TONE[data.status] ?? "slate"}>{data.status === "preview" ? "live preview" : data.status}</Badge>
            </div>
            <p className="mt-1 text-3xl font-bold">{currency}{formatNumber(b.netPayable)}</p>
            <p className="text-xs text-indigo-200">Payable now{b.salaryHoldAmount > 0 ? ` · ${currency}${formatNumber(b.salaryHoldAmount)} on hold` : ""}</p>
            <p className="mt-2 text-xs text-indigo-100">
              Cycle {formatDayKey(data.period.start)} – {formatDayKey(data.period.end)} · Pay date {formatDayKey(data.payDate)}
            </p>
          </div>

          {canEdit || (isAdmin && employeeId) ? (
            <Card className="mb-4">
              <div className="flex flex-wrap gap-2">
                {!data.frozen && (
                  <>
                    <Button size="sm" variant="secondary" loading={busy === "calculate"} onClick={() => act("calculate")}>Save draft</Button>
                    <Button size="sm" loading={busy === "finalize"} onClick={() => act("finalize", {}, "Finalize this salary? It will be frozen and can no longer be recalculated.")}>Finalize</Button>
                  </>
                )}
                {data.status === "finalized" && (
                  <Button size="sm" variant="success" loading={busy === "mark_paid"} onClick={() => act("mark_paid", {}, "Mark this salary as paid?")}>Mark as paid</Button>
                )}
              </div>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="mb-1 font-bold text-slate-900">Earnings</h3>
              <p className="mb-3 text-xs leading-relaxed text-slate-500">
                Every salary is worked out on a fixed 30-day month, so the daily rate is basic salary ÷ 30 in every month.
                Sundays and holidays are paid days. Each unpaid day (an unapproved absence, or leave not covered by comp-off) costs one daily rate.
              </p>
              <div className="space-y-2 text-sm">
                <Row label="Monthly basic salary" value={`${currency}${formatNumber(b.basicSalary)}`} />
                <Row label="Daily rate (basic ÷ 30)" value={`${currency}${formatNumber(b.dailyRate)}`} />
                <Row label="Full days present (incl. late)" value={`${formatNumber(b.presentDays, 0)}`} />
                <Row label="Unpaid unapproved absences" value={`${formatNumber(b.absentDays, 0)} day(s)`} />
                <Row label="Attendance-based salary" value={`${currency}${formatNumber(b.attendanceSalary)}`} bold />
                {b.weekOffWorkedDays > 0 && (
                  <Row label="Weekly-off days worked (each earns 1 comp-off)" value={`${b.weekOffWorkedDays} day(s)`} />
                )}
                {b.compOffUsed > 0 && (
                  <Row label="Comp-off used against leave (paid leave)" value={`${b.compOffUsed} day(s)`} />
                )}
                {(b.overtimePay > 0 || b.overtimeMinutes > 0) && (
                  <Row label={`Overtime (${formatNumber(b.overtimeMinutes / 60, 1)} h)`} value={`+${currency}${formatNumber(b.overtimePay)}`} />
                )}
                {b.extraPayDays > 0 && (
                  <Row label={`Extra pay for unused comp-off (${b.extraPayDays} day(s))`} value={`+${currency}${formatNumber(b.extraPay)}`} />
                )}
                {b.compOffUnused > 0 && b.extraPayDays === 0 && (
                  <Row label={`Unused comp-off lapsed at cycle end (${b.compOffUnused} day(s))`} value="No pay" />
                )}
                {b.additions.map((a, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-slate-500">{a.label}</span>
                    <span className="flex items-center gap-2 font-semibold text-emerald-600">
                      +{currency}{formatNumber(a.amount)}
                      {canEdit && (
                        <button onClick={() => act("remove_addition", { index: i })} className="text-[11px] font-semibold text-slate-400 hover:text-rose-600" aria-label="Remove bonus">✕</button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
              {canEdit && (
                <div className="mt-3 grid grid-cols-1 items-end gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-5">
                  <div className="sm:col-span-3"><Input label="Bonus / allowance" value={aLabel} onChange={setALabel} placeholder="e.g. Festival bonus" /></div>
                  <div className="sm:col-span-2"><Input label="Amount" type="number" value={aAmount} onChange={setAAmount} /></div>
                  <Button className="sm:col-span-5" size="sm" variant="secondary" disabled={!aLabel.trim() || !(Number(aAmount) > 0)} onClick={async () => { await act("add_addition", { label: aLabel, amount: Number(aAmount) }); setALabel(""); setAAmount(""); }}>
                    Add bonus
                  </Button>
                </div>
              )}

              <h3 className="mb-2 mt-5 font-bold text-slate-900">Deductions</h3>
              <div className="space-y-2 text-sm">
                <Row label={`Late attendance (${b.lateDays} day(s), incl. late-marks rule)`} value={`-${currency}${formatNumber(b.lateDeduction)}`} negative />
                {(b.earlyLeaveDays > 0 || b.earlyLeaveDeduction > 0) && (
                  <Row label={`Early leave (${b.earlyLeaveDays} day(s))`} value={`-${currency}${formatNumber(b.earlyLeaveDeduction)}`} negative />
                )}
                <Row label={`Half-day (${b.halfDays} day(s))`} value={`-${currency}${formatNumber(b.halfDayDeduction)}`} negative />
                <Row label={`Approved leave (${formatNumber(b.unpaidLeaveDays, 0)} unpaid of ${formatNumber(b.leaveDays, 0)} day(s))`} value={`-${currency}${formatNumber(b.leaveDeduction)}`} negative />
                {b.otherDeductions.map((d, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-slate-500">{d.label}</span>
                    <span className="flex items-center gap-2 font-semibold text-rose-600">
                      -{currency}{formatNumber(d.amount)}
                      {canEdit && (
                        <button onClick={() => act("remove_deduction", { index: i })} className="text-[11px] font-semibold text-slate-400 hover:text-rose-600" aria-label="Remove deduction">✕</button>
                      )}
                    </span>
                  </div>
                ))}
                <Row label="Total deductions" value={`-${currency}${formatNumber(b.totalDeductions)}`} negative bold />
              </div>

              {canEdit && (
                <div className="mt-3 grid grid-cols-1 items-end gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-5">
                  <div className="sm:col-span-3"><Input label="Other deduction" value={dLabel} onChange={setDLabel} placeholder="e.g. Advance recovery" /></div>
                  <div className="sm:col-span-2"><Input label="Amount" type="number" value={dAmount} onChange={setDAmount} /></div>
                  <Button className="sm:col-span-5" size="sm" variant="secondary" disabled={!dLabel.trim() || !(Number(dAmount) > 0)} onClick={async () => { await act("add_deduction", { label: dLabel, amount: Number(dAmount) }); setDLabel(""); setDAmount(""); }}>
                    Add deduction
                  </Button>
                </div>
              )}

              <div className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
                <Row label="Net after deductions" value={`${currency}${formatNumber(b.netBeforeHold)}`} />
                <Row label={`Unapproved-leave hold (${b.salaryHoldDays} day(s)) — temporary`} value={`-${currency}${formatNumber(b.salaryHoldAmount)}`} negative />
              </div>
              <div className="mt-3 rounded-xl bg-emerald-50 p-3">
                <Row label="Payable now" value={`${currency}${formatNumber(b.netPayable)}`} bold />
              </div>
            </Card>

            <div className="space-y-4">
              <Card>
                <h3 className="mb-1 font-bold text-slate-900">Salary Holds (Unapproved Leave)</h3>
                <p className="mb-3 text-xs text-slate-500">Holds are temporary and are not deductions. Each unapproved absence adds {me?.settings?.unapprovedHoldDays ?? 2} days of salary to the hold; an admin can release it.</p>
                {data.holds.length === 0 ? (
                  <p className="text-sm text-slate-400">No salary holds this month.</p>
                ) : (
                  <div className="space-y-2">
                    {data.holds.map((h, i) => (
                      <div key={h.id ?? i} className="flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm">
                        <div>
                          <p className="font-semibold text-amber-800">{h.reason} · {formatDate(h.occurrenceDate)}</p>
                          <p className="text-xs text-amber-600">{h.days} day(s) hold</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-amber-800">{currency}{formatNumber(h.amount)}</p>
                          <Badge tone={h.status === "released" ? "green" : "amber"}>{h.status}</Badge>
                          {isAdmin && h.id && h.status === "active" && data.status !== "paid" && (
                            <button onClick={() => act("release_hold", { holdId: h.id }, "Release this hold and return the amount to the employee?")} className="ml-2 text-xs font-semibold text-indigo-600 hover:underline">
                              Release
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {isAdmin && data.holds.some((h) => !h.id) && (
                  <p className="mt-2 text-[11px] text-slate-400">Save the draft to create releasable hold records.</p>
                )}
              </Card>

              <Card>
                <h3 className="mb-3 font-bold text-slate-900">Salary History</h3>
                <div className="space-y-2">
                  {data.history.map((h) => (
                    <div key={h.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                      <div>
                        <p className="font-semibold text-slate-700">{h.periodStart && h.periodEnd ? `${formatDayKey(h.periodStart)} – ${formatDayKey(h.periodEnd)}` : monthLabel(h.year, h.month)} <Badge tone={STATUS_TONE[h.status] ?? "slate"}>{h.status}</Badge></p>
                        <p className="text-xs text-slate-400">Earned {currency}{formatNumber(h.attendanceSalary)} · Deductions {currency}{formatNumber(h.totalDeductions)} · Held {currency}{formatNumber(h.salaryHoldAmount)}</p>
                      </div>
                      <p className="font-bold text-emerald-600">{currency}{formatNumber(h.netPayable)}</p>
                    </div>
                  ))}
                  {data.history.length === 0 && <p className="text-sm text-slate-400">No finalized salaries yet.</p>}
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value, negative, bold }: { label: string; value: string; negative?: boolean; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold ${bold ? "text-slate-900" : negative ? "text-rose-600" : "text-slate-700"}`}>{value}</span>
    </div>
  );
}
