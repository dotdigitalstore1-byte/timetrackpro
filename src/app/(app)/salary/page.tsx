"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, downloadBlob, hasPower, useMe } from "@/lib/client";
import { Badge, Button, Card, Input, PageHeader, Select, Spinner } from "@/components/ui";
import EmployeePicker from "@/components/EmployeePicker";
import { AdminSlipRequests, EmployeeSlipsCard } from "@/components/SalarySlips";
import { formatDate, formatDayKey, formatNumber, monthLabel, CURRENCY } from "@/lib/utils";

interface SalaryData {
  employee: { id: string; fullName: string; designation: string | null } | null;
  month: number;
  year: number;
  period: { start: string; end: string };
  cycles: { key: string; start: string; end: string }[];
  salaryDate: string;
  disbursementDate: string;
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
    holidayDeductionDays: number;
    holidayDeduction: number;
    otherDeductions: { label: string; amount: number }[];
    totalDeductions: number;
    salaryHoldDays: number;
    salaryHoldAmount: number;
    netBeforeHold: number;
    netPayable: number;
    ledger: LedgerLine[] | null;
  };
  holds: { id: string | null; days: number; unapprovedDays: number; amount: number; reason: string; occurrenceDate: string; status: string }[];
  history: { id: string; month: number; year: number; periodStart: string | null; periodEnd: string | null; basicSalary: string; attendanceSalary: string; totalDeductions: string; salaryHoldAmount: string; netPayable: string; status: string; disbursementDate: string | null }[];
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
  const currency = CURRENCY;

  const [month, setMonth] = useState(""); // empty = server decides the current month in company timezone
  const [rangeMode, setRangeMode] = useState<"cycle" | "custom">("cycle");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [employees, setEmployees] = useState<{ id: string; fullName: string; employeeCode?: string | null }[]>([]);
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
    // Admins open a payslip only for a chosen employee; the overview covers everyone else.
    if (isAdmin && !employeeId) {
      setData(null);
      setLoading(false);
      return;
    }
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
      api<{ employees: { id: string; fullName: string; employeeCode?: string | null }[] }>("/api/employees")
        .then((d) => setEmployees(d.employees))
        .catch(() => setEmployees([]));
    }
  }, [canPick, employees.length]);


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
      <PageHeader title="Salary" subtitle="Transparent attendance-based payroll — deductions, and salary delays for unapproved leave, are shown separately" />

      {isAdmin && (
        <div className="mb-4">
          <AdminSlipRequests />
        </div>
      )}

      {isAdmin && (
        <AdminSalaryOverview
          rangeMode={rangeMode}
          setRangeMode={setRangeMode}
          month={month}
          setMonth={setMonth}
          customFrom={customFrom}
          setCustomFrom={setCustomFrom}
          customTo={customTo}
          setCustomTo={setCustomTo}
          employeeId={employeeId}
          setEmployeeId={setEmployeeId}
          employees={employees}
        />
      )}

      <Card className="mb-4">
        {!isAdmin && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            label="Salary cycle"
            value={month || data?.cycles?.[0]?.key || ""}
            onChange={setMonth}
            options={(data?.cycles ?? []).map((c) => ({
              value: c.key,
              label: `${formatDayKey(c.start)} – ${formatDayKey(c.end)}${data?.cycles?.[0]?.key === c.key ? " (current)" : ""}`,
            }))}
          />
          {canPick && !isAdmin && (
            <EmployeePicker
              label="Employee"
              value={employeeId}
              onChange={setEmployeeId}
              items={employees.map((e) => ({ id: e.id, name: e.fullName, code: e.employeeCode }))}
            />
          )}
        </div>}
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

      {isAdmin && (!employeeId || rangeMode === "custom") ? (
        <div id="salary-detail">
          <Card>
            <p className="text-center text-sm text-slate-400">
              {rangeMode === "custom"
                ? "Payslips are worked out for salary cycles. Switch to a salary cycle to open an employee's payslip."
                : "Choose an employee in the table above to open their payslip, deductions and salary history."}
            </p>
          </Card>
        </div>
      ) : loading ? (
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
            <p className="text-xs text-indigo-200">Net payable for this cycle{b.salaryHoldDays > 0 ? ` · paid ${b.salaryHoldDays} day(s) after the salary date` : ""}</p>
            <p className="mt-2 text-xs text-indigo-100">
              Cycle {formatDayKey(data.period.start)} – {formatDayKey(data.period.end)} · Salary date {formatDayKey(data.salaryDate)}
              {data.disbursementDate !== data.salaryDate ? <> · Disburses {formatDayKey(data.disbursementDate)}</> : null}
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
                Sundays and holidays are paid days unless the Sunday/holiday rule cuts them (see Deductions). Each unpaid day (an unapproved absence, or leave not covered by comp-off) costs one daily rate.
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
                {b.holidayDeduction > 0 && (
                  <Row label={`Sunday / holiday pay cut (${b.holidayDeductionDays} day(s), unauthorized leave around it)`} value={`-${currency}${formatNumber(b.holidayDeduction)}`} negative />
                )}
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

              {b.salaryHoldAmount > 0 && (
                <div className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
                  <Row label="Net after deductions" value={`${currency}${formatNumber(b.netBeforeHold)}`} />
                  <Row label="Held under the earlier rule (temporary)" value={`-${currency}${formatNumber(b.salaryHoldAmount)}`} negative />
                </div>
              )}
              <div className="mt-4 rounded-xl bg-emerald-50 p-3">
                <Row label="Net payable" value={`${currency}${formatNumber(b.netPayable)}`} bold />
                <Row label="Salary date" value={formatDayKey(data.salaryDate)} />
                <Row label="Disburses on" value={formatDayKey(data.disbursementDate)} bold />
                {b.salaryHoldDays > 0 && (
                  <p className="mt-2 text-xs text-amber-700">
                    Delayed {b.salaryHoldDays} day(s) for unapproved leave. The full amount is paid, later than the salary date.
                  </p>
                )}
              </div>
            </Card>

            <div className="space-y-4">
              <Card>
                <h3 className="mb-1 font-bold text-slate-900">Salary delay (unapproved leave)</h3>
                <p className="mb-3 text-xs leading-relaxed text-slate-500">
                  {me?.settings?.salaryHoldEnabled === false
                    ? "The salary hold is switched off, so unapproved days do not delay the salary."
                    : `Each unapproved day delays the disbursement date by ${me?.settings?.unapprovedHoldDays ?? 2} days, counted from the salary date (${formatDayKey(data.salaryDate)}). The salary is not reduced; it is paid later.`}
                </p>
                {data.holds.length === 0 ? (
                  <p className="text-sm text-slate-400">No unapproved days this cycle, so no delay.</p>
                ) : (
                  <div className="space-y-2">
                    {data.holds.map((h, i) => (
                      <div key={h.id ?? i} className="flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm">
                        <div>
                          <p className="font-semibold text-amber-800">Unapproved from {formatDate(h.occurrenceDate)}</p>
                          <p className="text-xs text-amber-600">
                            {h.amount > 0
                              ? `Money held under the earlier rule: ${currency}${formatNumber(h.amount)}`
                              : `${h.unapprovedDays} unapproved day(s) → ${h.days} day(s) delay${h.status === "released" ? " (released)" : ""}`}
                          </p>
                        </div>
                        <div className="text-right">
                          <Badge tone={h.status === "released" ? "green" : "amber"}>{h.status}</Badge>
                          {isAdmin && h.id && h.status === "active" && data.status !== "paid" && (
                            <button onClick={() => act("release_hold", { holdId: h.id }, "Release this delay? These days will not delay the salary.")} className="ml-2 text-xs font-semibold text-indigo-600 hover:underline">
                              Release
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
                  <Row label="Salary date" value={formatDayKey(data.salaryDate)} />
                  <Row label={`Delay for unapproved leave (${b.salaryHoldDays} day(s))`} value={`+${b.salaryHoldDays} day(s)`} />
                  <Row label="Disbursement date" value={formatDayKey(data.disbursementDate)} bold />
                </div>
                {isAdmin && data.holds.some((h) => !h.id) && (
                  <p className="mt-2 text-[11px] text-slate-400">Save the draft to create releasable delay records.</p>
                )}
              </Card>

              <Card>
                <h3 className="mb-3 font-bold text-slate-900">Salary History</h3>
                <div className="space-y-2">
                  {data.history.map((h) => (
                    <div key={h.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                      <div>
                        <p className="font-semibold text-slate-700">{h.periodStart && h.periodEnd ? `${formatDayKey(h.periodStart)} – ${formatDayKey(h.periodEnd)}` : monthLabel(h.year, h.month)} <Badge tone={STATUS_TONE[h.status] ?? "slate"}>{h.status}</Badge></p>
                        <p className="text-xs text-slate-400">Earned {currency}{formatNumber(h.attendanceSalary)} · Deductions {currency}{formatNumber(h.totalDeductions)} {h.disbursementDate ? `· Disburses ${formatDayKey(h.disbursementDate)}` : ""}</p>
                      </div>
                      <p className="font-bold text-emerald-600">{currency}{formatNumber(h.netPayable)}</p>
                    </div>
                  ))}
                  {data.history.length === 0 && <p className="text-sm text-slate-400">No finalized salaries yet.</p>}
                </div>
              </Card>
            </div>
          </div>
          <div className="mt-4">
            <DeductionLog
              ledger={b.ledger}
              currency={currency}
              absentDeduction={Math.max(0, b.basicSalary - b.attendanceSalary)}
              totalDeductions={b.totalDeductions}
            />
          </div>
          {!isAdmin && (
            <div className="mt-4">
              <EmployeeSlipsCard history={data.history} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface LedgerLine {
  date: string | null;
  kind: string;
  reason: string;
  amount: number;
}

/** The day-wise deduction log: every amount taken off, on the day it applies to, with the reason. */
function DeductionLog({ ledger, currency, absentDeduction, totalDeductions }: { ledger: LedgerLine[] | null; currency: string; absentDeduction: number; totalDeductions: number }) {
  const money = (n: number) => `${currency}${formatNumber(n)}`;
  if (ledger === null) {
    return (
      <Card>
        <h3 className="mb-1 font-bold text-slate-900">Day-wise deduction log</h3>
        <p className="text-sm text-slate-400">Not recorded for this salary. The day-by-day log is kept for salaries finalized after it was introduced.</p>
      </Card>
    );
  }
  const taken = Math.round(ledger.reduce((t, l) => t + l.amount, 0) * 100) / 100;
  const expected = Math.round((absentDeduction + totalDeductions) * 100) / 100;
  return (
    <Card>
      <h3 className="mb-1 font-bold text-slate-900">Day-wise deduction log</h3>
      <p className="mb-3 text-xs leading-relaxed text-slate-500">
        Every amount taken off this salary, on the day it applies to, with the reason. Unpaid absences are listed here too, even though Earnings shows them as a reduction.
      </p>
      {ledger.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing was deducted this cycle.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Reason</th>
                <th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((l, i) => (
                <tr key={i} className="border-b border-slate-100 align-top">
                  <td className="whitespace-nowrap py-2 pr-3 font-medium text-slate-700">{l.date ? formatDayKey(l.date) : "No date"}</td>
                  <td className="py-2 pr-3 text-slate-600">{l.reason}</td>
                  <td className={`whitespace-nowrap py-2 text-right font-semibold ${l.amount > 0 ? "text-rose-600" : "text-slate-400"}`}>
                    {l.amount > 0 ? `−${money(l.amount)}` : "not deducted"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold text-slate-900">
                <td className="py-2 pr-3" colSpan={2}>Total taken off this cycle</td>
                <td className="py-2 text-right text-rose-600">−{money(taken)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {ledger.length > 0 && Math.abs(taken - expected) < 0.5 && (
        <p className="mt-2 text-[11px] text-slate-400">Matches the deductions above plus unpaid absences. Lines are rounded to paise.</p>
      )}
    </Card>
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

// ---------------------------------------------------------------------------
// Admin: company-wide salary overview (cycle or custom range), sorting, filters, and exports.
// ---------------------------------------------------------------------------

interface OverviewRowT {
  employeeId: string;
  name: string;
  code: string | null;
  designation: string | null;
  departments: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  status: string;
  gross: number;
  deductions: number;
  credits: number;
  holds: number;
  net: number;
  lateDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  unpaidLeaveDays: number;
  earlyLeaveDays: number;
  overtimeMinutes: number;
  additions: number;
  overtimePay: number;
  extraPay: number;
  flags: { excessiveLeave: boolean; lateMarks: boolean };
}

interface OverviewTotalsT {
  employees: number;
  gross: number;
  deductions: number;
  credits: number;
  holds: number;
  net: number;
  lateDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  flagged: number;
  statusCounts: { preview: number; draft: number; finalized: number; paid: number };
}

interface OverviewData {
  range: { key: string; label: string; start: string | null; end: string | null; isCustom: boolean };
  cycles: { key: string; start: string; end: string }[];
  currency: string;
  lateMarksLimit: number;
  rows: OverviewRowT[];
  totals: OverviewTotalsT;
  companyTotals: OverviewTotalsT;
}

type SortKey = "name" | "department" | "gross" | "deductions" | "net" | "late" | "half" | "absent" | "leave";
type GroupBy = "company" | "location" | "department" | "employee";

const GROUP_OPTIONS: { value: GroupBy; label: string; hint: string }[] = [
  { value: "company", label: "Company-wide", hint: "One sheet with every employee and company totals" },
  { value: "location", label: "Location-wise", hint: "A sheet per work location, with totals" },
  { value: "department", label: "Department-wise", hint: "A sheet per department, with totals" },
  { value: "employee", label: "Employee-wise", hint: "A sheet per employee with a day-by-day breakdown" },
];

const SALARY_STATUS_TONE: Record<string, "slate" | "amber" | "indigo" | "green"> = {
  preview: "slate",
  draft: "amber",
  finalized: "indigo",
  paid: "green",
};

function AdminSalaryOverview({
  rangeMode,
  setRangeMode,
  month,
  setMonth,
  customFrom,
  setCustomFrom,
  customTo,
  setCustomTo,
  employeeId,
  setEmployeeId,
  employees,
}: {
  rangeMode: "cycle" | "custom";
  setRangeMode: (m: "cycle" | "custom") => void;
  month: string;
  setMonth: (m: string) => void;
  customFrom: string;
  setCustomFrom: (v: string) => void;
  customTo: string;
  setCustomTo: (v: string) => void;
  employeeId: string;
  setEmployeeId: (v: string) => void;
  employees: { id: string; fullName: string; employeeCode?: string | null }[];
}) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deptId, setDeptId] = useState("");
  const [locId, setLocId] = useState("");
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [groupBy, setGroupBy] = useState<GroupBy>("company");
  const [withPhotos, setWithPhotos] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [exportError, setExportError] = useState("");

  const customReady = !!customFrom && !!customTo;
  const query = useMemo(() => {
    const qs = new URLSearchParams();
    if (rangeMode === "custom") {
      if (customFrom) qs.set("from", customFrom);
      if (customTo) qs.set("to", customTo);
    } else if (month) {
      qs.set("month", month);
    }
    if (deptId) qs.set("departmentId", deptId);
    if (locId) qs.set("locationId", locId);
    if (employeeId) qs.set("employeeId", employeeId);
    return qs.toString();
  }, [rangeMode, month, customFrom, customTo, deptId, locId, employeeId]);

  useEffect(() => {
    api<{ departments: { id: string; name: string }[] }>("/api/departments")
      .then((d) => setDepartments(d.departments))
      .catch(() => setDepartments([]));
    api<{ locations: { id: string; name: string }[] }>("/api/locations")
      .then((d) => setLocations(d.locations))
      .catch(() => setLocations([]));
  }, []);

  useEffect(() => {
    if (rangeMode === "custom" && !customReady) {
      setLoading(false);
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    api<OverviewData>(`/api/salary/overview?${query}`)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        // first load in cycle mode: show the cycle the server picked
        if (rangeMode === "cycle" && !month) setMonth(d.range.key);
      })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        setError(e instanceof Error ? e.message : "Could not load the salary overview");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, rangeMode, customReady]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = (data?.rows ?? []).filter(
      (r) => !q || r.name.toLowerCase().includes(q) || (r.code ?? "").toLowerCase().includes(q)
    );
    const value = (r: OverviewRowT): string | number => {
      switch (sortKey) {
        case "name": return r.name.toLowerCase();
        case "department": return (r.departments[0]?.name ?? "~").toLowerCase();
        case "gross": return r.gross;
        case "deductions": return r.deductions;
        case "net": return r.net;
        case "late": return r.lateDays;
        case "half": return r.halfDays;
        case "absent": return r.absentDays;
        default: return r.leaveDays;
      }
    };
    return [...filtered].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, search, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "name" || k === "department" ? "asc" : "desc");
    }
  };

  const cur = CURRENCY;
  const t = data?.totals;
  const money = (n: number) => `${cur}${formatNumber(n)}`;
  const attention = (data?.rows ?? []).filter((r) => r.flags.excessiveLeave || r.flags.lateMarks);

  const exportFile = async () => {
    if (rangeMode === "custom" && !customReady) return setExportError("Choose both dates for the custom range.");
    setDownloading(true);
    setExportError("");
    try {
      const qs = new URLSearchParams(query);
      qs.set("groupBy", groupBy);
      qs.set("photos", withPhotos ? "1" : "0");
      const res = await fetch(`/api/salary/export?${qs}`, { credentials: "same-origin" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Export failed");
      }
      const blob = await res.blob();
      const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] || "salary.xlsx";
      downloadBlob(blob, name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setDownloading(false);
    }
  };

  const Th = ({ k, children, align = "left" }: { k: SortKey; children: ReactNode; align?: "left" | "right" }) => (
    <th className={`px-3 py-2.5 font-semibold ${align === "right" ? "text-right" : "text-left"}`}>
      <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-indigo-700">
        {children}
        <span className="text-[10px] text-slate-400">{sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );

  return (
    <div className="mb-6 space-y-4">
      {/* Controls */}
      <Card className="p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-12 md:items-end">
          <div className="col-span-2 flex rounded-xl bg-slate-100 p-1 text-xs font-semibold md:col-span-3">
            {(["cycle", "custom"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setRangeMode(m)}
                className={`flex-1 rounded-lg px-3 py-2 transition ${rangeMode === m ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                {m === "cycle" ? "Salary cycle" : "Custom dates"}
              </button>
            ))}
          </div>

          {rangeMode === "cycle" ? (
            <div className="col-span-2 md:col-span-9">
              <Select
                label="Salary cycle"
                value={month || data?.range.key || ""}
                onChange={setMonth}
                options={(data?.cycles ?? []).map((c, i) => ({
                  value: c.key,
                  label: `${formatDayKey(c.start)} – ${formatDayKey(c.end)}${i === 0 ? " (current)" : ""}`,
                }))}
              />
            </div>
          ) : (
            <>
              <div className="col-span-1 md:col-span-4"><Input label="From" type="date" value={customFrom} onChange={setCustomFrom} /></div>
              <div className="col-span-1 md:col-span-5"><Input label="To" type="date" value={customTo} onChange={setCustomTo} /></div>
            </>
          )}

          <div className="col-span-1 md:col-span-3">
            <Select label="Department" value={deptId} onChange={setDeptId} options={[{ value: "", label: "All departments" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]} />
          </div>
          <div className="col-span-1 md:col-span-3">
            <Select label="Location" value={locId} onChange={setLocId} options={[{ value: "", label: "All locations" }, ...locations.map((l) => ({ value: l.id, label: l.name }))]} />
          </div>
          <div className="col-span-2 md:col-span-4">
            <EmployeePicker label="Employee" value={employeeId} onChange={setEmployeeId} allLabel="All employees" items={employees.map((e) => ({ id: e.id, name: e.fullName, code: e.employeeCode }))} />
          </div>
          <div className="col-span-2 flex items-center justify-between gap-3 md:col-span-2 md:justify-end">
            <p className="text-xs text-slate-500 md:hidden">
              {rangeMode === "custom" ? (customReady ? `${customFrom} → ${customTo}` : "Choose both dates") : data ? data.range.label : "Loading…"}
            </p>
            {(deptId || locId || employeeId) && (
              <Button size="sm" variant="secondary" onClick={() => { setDeptId(""); setLocId(""); setEmployeeId(""); }}>Clear filters</Button>
            )}
          </div>
        </div>
        <p className="mt-3 hidden text-xs text-slate-500 md:block">
          {rangeMode === "custom"
            ? customReady ? `Custom range ${customFrom} to ${customTo}. Payslips are shown for salary cycles only.` : "Choose a start and end date."
            : data ? `Salary cycle ${data.range.label}` : "Loading…"}
          {(deptId || locId || employeeId) && " · Filtered"}
        </p>
      </Card>

      {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>}

      {loading && !data ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : data && t ? (
        <>
          {/* Headline figures */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:text-[11px]">Total payable</p>
              <p className="mt-1.5 text-xl font-bold tabular-nums text-slate-900 sm:mt-2 sm:text-3xl">{money(t.gross)}</p>
              <p className="mt-1 text-[11px] leading-snug text-slate-500 sm:text-xs">Gross basic · {t.employees} employee{t.employees === 1 ? "" : "s"}</p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-rose-600 sm:text-[11px]">Total deductions</p>
              <p className="mt-1.5 text-xl font-bold tabular-nums text-rose-600 sm:mt-2 sm:text-3xl">−{money(t.deductions)}</p>
              <p className="mt-1 text-[11px] leading-snug text-slate-500 sm:text-xs">Absent, late, half-day &amp; leave</p>
            </div>
            <div className="col-span-2 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 p-4 text-white shadow-sm sm:p-5 md:col-span-1">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-100 sm:text-[11px]">Net payable balance</p>
                  <p className="mt-1.5 text-2xl font-bold tabular-nums sm:mt-2 sm:text-3xl">{money(t.net)}</p>
                </div>
                <p className="shrink-0 text-right text-[11px] leading-snug text-indigo-100 sm:text-xs">
                  {t.holds > 0 ? <>{money(t.holds)}<br />held (earlier rule)</> : "paid in full on the disbursement date"}
                </p>
              </div>
            </div>
          </div>

          {/* Reconciliation */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <span className="font-semibold text-slate-700">How it adds up:</span>
            <span>Gross {money(t.gross)}</span>
            <span>− deductions {money(t.deductions)}</span>
            <span>+ additions, overtime & extra pay {money(t.credits)}</span>
            {t.holds > 0 && <span>− held under the earlier rule {money(t.holds)}</span>}
            <span>= <b className="text-slate-900">{money(t.net)}</b></span>
          </div>

          {/* Secondary figures */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {[
              { label: "Additions & extra", value: money(t.credits), tone: "bg-emerald-50 text-emerald-700" },
              { label: "Late days", value: formatNumber(t.lateDays, 0), tone: "bg-amber-50 text-amber-700" },
              { label: "Half days", value: formatNumber(t.halfDays, 0), tone: "bg-amber-50 text-amber-700" },
              { label: "Absent days", value: formatNumber(t.absentDays, 0), tone: "bg-rose-50 text-rose-700" },
              { label: "Leave days", value: formatNumber(t.leaveDays, 0), tone: "bg-sky-50 text-sky-700" },
              { label: "Flagged people", value: String(t.flagged), tone: "bg-violet-50 text-violet-700" },
              { label: "Not calculated", value: String(t.statusCounts.preview), tone: "bg-slate-100 text-slate-600" },
              { label: "Finalised / paid", value: `${t.statusCounts.finalized} / ${t.statusCounts.paid}`, tone: "bg-indigo-50 text-indigo-700" },
            ].map((x) => (
              <div key={x.label} className={`rounded-xl p-3 ${x.tone}`}>
                <p className="text-base font-bold">{x.value}</p>
                <p className="text-[10px] font-bold uppercase opacity-80">{x.label}</p>
              </div>
            ))}
          </div>

          {/* Needs attention */}
          {attention.length > 0 && (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-bold text-slate-900">Needs attention</h3>
                <span className="text-xs text-slate-500">{attention.length} person(s)</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {attention.map((r) => (
                  <button
                    key={r.employeeId}
                    type="button"
                    onClick={() => { setEmployeeId(r.employeeId); document.getElementById("salary-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left transition hover:border-indigo-300 hover:bg-indigo-50/40"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-800">{r.name}</span>
                      <span className="block truncate text-xs text-slate-500">{r.departments.map((d) => d.name).join(", ") || "No department"}</span>
                    </span>
                    <span className="flex flex-wrap justify-end gap-1">
                      {r.flags.excessiveLeave && <Badge tone="indigo">{formatNumber(r.leaveDays, 1)} leave days</Badge>}
                      {r.flags.lateMarks && <Badge tone="amber">{r.lateDays} late</Badge>}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-slate-400">Excessive leave: 3 or more leave days in the cycle. Late marks: at or above your late-marks limit (3 if none is set).</p>
            </Card>
          )}

          {/* Employee table */}
          <Card className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="font-bold text-slate-900">Employees</h3>
                <p className="text-xs text-slate-500">Click a row to open that employee's payslip below.</p>
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or code…"
                className="w-56 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm outline-none focus:border-indigo-500"
              />
            </div>
            {rows.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-400">No employees match these filters.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <Th k="name">Employee</Th>
                      <Th k="department">Department</Th>
                      <Th k="gross" align="right">Gross</Th>
                      <Th k="deductions" align="right">Deductions</Th>
                      <Th k="net" align="right">Net payable</Th>
                      <Th k="late" align="right">Late</Th>
                      <Th k="half" align="right">Half</Th>
                      <Th k="absent" align="right">Absent</Th>
                      <Th k="leave" align="right">Leave</Th>
                      <th className="px-3 py-2.5 text-left font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.employeeId}
                        onClick={() => { setEmployeeId(r.employeeId); document.getElementById("salary-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                        className={`cursor-pointer border-t border-slate-100 hover:bg-indigo-50/50 ${employeeId === r.employeeId ? "bg-indigo-50" : ""}`}
                      >
                        <td className="px-3 py-2.5">
                          <p className="font-semibold text-slate-800">{r.name}</p>
                          <p className="text-xs text-slate-400">{r.code ? `${r.code} · ` : ""}{r.designation ?? "—"}</p>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">{r.departments.map((d) => d.name).join(", ") || "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(r.gross)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-rose-600">{r.deductions > 0 ? `−${formatNumber(r.deductions)}` : "0"}</td>
                        <td className="px-3 py-2.5 text-right font-bold tabular-nums text-emerald-700">{formatNumber(r.net)}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${r.flags.lateMarks ? "font-bold text-amber-700" : ""}`}>{r.lateDays || "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.halfDays || "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.absentDays || "—"}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${r.flags.excessiveLeave ? "font-bold text-indigo-700" : ""}`}>{r.leaveDays || "—"}</td>
                        <td className="px-3 py-2.5">
                          <Badge tone={SALARY_STATUS_TONE[r.status] ?? "slate"}>{r.status === "preview" ? "not calculated" : r.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-sm font-bold">
                    <tr>
                      <td className="px-3 py-2.5" colSpan={2}>Total ({rows.length} shown)</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(rows.reduce((s, r) => s + r.gross, 0))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-rose-600">−{formatNumber(rows.reduce((s, r) => s + r.deductions, 0))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{formatNumber(rows.reduce((s, r) => s + r.net, 0))}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{rows.reduce((s, r) => s + r.lateDays, 0)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{rows.reduce((s, r) => s + r.halfDays, 0)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(rows.reduce((s, r) => s + r.absentDays, 0), 1)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(rows.reduce((s, r) => s + r.leaveDays, 0), 1)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>

          {/* Exports */}
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="font-bold text-slate-900">Download report</h3>
                <p className="text-xs text-slate-500">Excel workbook for {rangeMode === "custom" ? (customReady ? `${customFrom} to ${customTo}` : "your chosen dates") : data.range.label}, with the filters above applied.</p>
              </div>
              <Button onClick={exportFile} loading={downloading} disabled={rangeMode === "custom" && !customReady}>Download Excel</Button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {GROUP_OPTIONS.map((g) => (
                  <button
                    key={g.value}
                    type="button"
                    onClick={() => setGroupBy(g.value)}
                    className={`rounded-xl border p-3 text-left transition ${groupBy === g.value ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-slate-300"}`}
                  >
                    <p className="text-sm font-semibold text-slate-800">{g.label}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{g.hint}</p>
                  </button>
                ))}
              </div>
              <label className="flex max-w-xs cursor-pointer items-start gap-2 rounded-xl border border-slate-200 p-3 text-sm">
                <input type="checkbox" className="mt-1" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} />
                <span>
                  <span className="block font-semibold text-slate-800">Include photos</span>
                  <span className="block text-[11px] text-slate-500">Adds each employee&apos;s latest punch-in photo for the period. Up to 300 employees.</span>
                </span>
              </label>
            </div>
            {exportError && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{exportError}</p>}
          </Card>
        </>
      ) : null}
    </div>
  );
}
