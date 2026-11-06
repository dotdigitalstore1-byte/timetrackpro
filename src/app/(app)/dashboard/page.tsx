"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, useMe } from "@/lib/client";
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatCard } from "@/components/ui";
import PunchCard from "@/components/PunchCard";
import { formatDate, formatNumber, monthLabel } from "@/lib/utils";

interface AttendanceRow {
  id: string;
  employeeName: string;
  workDate: string;
  punchInTime: string | null;
  punchOutTime: string | null;
  status: string;
}

interface LeaveRow {
  id: string;
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: string;
  reason: string;
  status: string;
  currentLevel: number;
}

interface SalaryData {
  month: number;
  year: number;
  breakdown: {
    basicSalary: number;
    attendanceSalary: number;
    totalDeductions: number;
    netPayable: number;
    presentDays: number;
    lateDays: number;
    halfDays: number;
    leaveDays: number;
    unapprovedLeaveCount: number;
    salaryHoldDays: number;
  };
  history: { id: string; month: number; year: number; netPayable: string }[];
}

interface LeaveBalance {
  year: number;
  quota: number;
  used: number;
  pending: number;
  remaining: number;
}

interface SetupItem {
  id: string;
  name: string;
  isActive: boolean;
  employeeCount: number;
}

interface RulesSummary {
  graceMinutes: number;
  lateThresholdMinutes: number;
  salaryCycleStartDay: number;
  overtimeEnabled: boolean;
  lateMarksLimit: number;
}

interface StatsData {
  today: {
    date: string;
    totalEmployees: number;
    present: number;
    absent: number;
    onLeave: number;
    late: number;
    pendingLeaves: number;
  };
  month: { totalPayroll: string; totalDeductions: string };
}

export default function DashboardPage() {
  const { me, loading: meLoading, error: meError } = useMe();
  const router = useRouter();

  useEffect(() => {
    if (me?.user.role === "super_admin") {
      router.replace("/superadmin");
    }
  }, [me, router]);

  if (meLoading || !me) {
    if (meError) {
      return (
        <Card>
          <p className="text-center text-sm font-medium text-rose-600">{meError}</p>
          <div className="mt-3 flex justify-center">
            <Link href="/login" className="text-sm font-semibold text-indigo-600 hover:underline">
              Sign in again
            </Link>
          </div>
        </Card>
      );
    }
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  return me.user.role === "company_admin" || me.user.role === "manager" ? (
    <AdminDashboard role={me.user.role} />
  ) : (
    <EmployeeDashboard />
  );
}

function EmployeeDashboard() {
  const { me } = useMe();
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [salary, setSalary] = useState<SalaryData | null>(null);
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [att, lv, sal] = await Promise.all([
        api<{ records: AttendanceRow[] }>(`/api/attendance`),
        api<{ leaves: LeaveRow[]; balance: LeaveBalance | null }>("/api/leaves"),
        api<SalaryData>(`/api/salary`),
      ]);
      setRecords(att.records);
      setLeaves(lv.leaves);
      setBalance(lv.balance);
      setSalary(sal);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const present = records.filter((r) => r.punchInTime && r.status !== "half_day").length;
  const half = records.filter((r) => r.status === "half_day").length;
  const late = records.filter((r) => r.status === "late").length;
  const absent = records.filter((r) => !r.punchInTime).length;

  return (
    <div>
      <PageHeader title={`Welcome back, ${me?.user.fullName.split(" ")[0] ?? ""}`} subtitle={me?.employee?.designation || "Employee"} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PunchCard onChanged={load} />
        </div>
        <div className="space-y-4">
          <Card>
            <h3 className="mb-3 font-bold text-slate-900">This Month</h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-emerald-50 p-3 text-center">
                <p className="text-xl font-bold text-emerald-700">{present + half}</p>
                <p className="text-[10px] font-bold uppercase text-emerald-600">Present</p>
              </div>
              <div className="rounded-xl bg-amber-50 p-3 text-center">
                <p className="text-xl font-bold text-amber-700">{late}</p>
                <p className="text-[10px] font-bold uppercase text-amber-600">Late</p>
              </div>
              <div className="rounded-xl bg-rose-50 p-3 text-center">
                <p className="text-xl font-bold text-rose-700">{absent}</p>
                <p className="text-[10px] font-bold uppercase text-rose-600">Absent</p>
              </div>
              <div className="rounded-xl bg-indigo-50 p-3 text-center">
                <p className="text-xl font-bold text-indigo-700">{half}</p>
                <p className="text-[10px] font-bold uppercase text-indigo-600">Half Days</p>
              </div>
            </div>
          </Card>
          <Card>
            <h3 className="mb-2 font-bold text-slate-900">Leave Balance</h3>
            {balance ? (
              <>
                <p className="text-3xl font-bold text-indigo-600">{balance.remaining}</p>
                <p className="text-xs text-slate-500">of {balance.quota} days remaining this year</p>
                <div className="mt-2 flex justify-between text-xs font-semibold text-slate-500">
                  <span>Approved: {balance.used}</span>
                  <span className="text-amber-600">Pending: {balance.pending}</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-400">No leave quota configured by your company.</p>
            )}
          </Card>
          <Card>
            <h3 className="mb-2 font-bold text-slate-900">Current Salary</h3>
            {salary ? (
              <>
                <p className="text-2xl font-bold text-emerald-600">
                  {me?.settings?.currency ?? "$"}
                  {formatNumber(salary.breakdown.netPayable)}
                </p>
                <p className="text-xs text-slate-500">{monthLabel(salary.year, salary.month)} · net payable</p>
                <div className="mt-2 space-y-1 text-xs text-slate-500">
                  <p className="flex justify-between"><span>Attendance salary</span><span>{me?.settings?.currency}{formatNumber(salary.breakdown.attendanceSalary)}</span></p>
                  <p className="flex justify-between"><span>Deductions</span><span className="text-rose-600">-{me?.settings?.currency}{formatNumber(salary.breakdown.totalDeductions)}</span></p>
                  <p className="flex justify-between"><span>Salary holds</span><span className="text-amber-600">{salary.breakdown.salaryHoldDays} days</span></p>
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-400">Loading…</p>
            )}
          </Card>
          <Card>
            <h3 className="mb-2 font-bold text-slate-900">My Work</h3>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-slate-400">My shift</p>
                <p className="font-semibold text-slate-700">
                  {me?.employee?.shiftStart && me.employee.shiftEnd ? `${me.employee.shiftStart} – ${me.employee.shiftEnd}` : "—"}
                  {me?.settings && me.settings.graceMinutes > 0 ? ` · ${me.settings.graceMinutes} min cool-off` : ""}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Departments</p>
                <p className="font-semibold text-slate-700">{me?.employee?.departments.map((d) => d.name).join(", ") || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Work locations</p>
                <p className="font-semibold text-slate-700">
                  {me?.employee?.locations.length ? me.employee.locations.map((l) => l.name).join(", ") : "Any company location"}
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
      {error && <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-center text-sm font-medium text-rose-700">{error}</p>}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-bold text-slate-900">Recent Attendance</h3>
            <Link href="/attendance" className="text-xs font-semibold text-indigo-600 hover:underline">View all →</Link>
          </div>
          {records.length === 0 ? (
            <EmptyState message="No attendance records this month." />
          ) : (
            <div className="space-y-2">
              {records.slice(0, 5).map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-slate-600">{formatDate(r.workDate)}</span>
                  <Badge tone={r.status === "present" ? "green" : r.status === "late" ? "amber" : "red"}>{r.status.replace("_", " ")}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-bold text-slate-900">Leave History</h3>
            <Link href="/leaves" className="text-xs font-semibold text-indigo-600 hover:underline">Request →</Link>
          </div>
          {leaves.length === 0 ? (
            <EmptyState message="No leave requests yet." />
          ) : (
            <div className="space-y-2">
              {leaves.slice(0, 5).map((l) => (
                <div key={l.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <div>
                    <p className="font-semibold text-slate-700">{formatDate(l.startDate)} → {formatDate(l.endDate)}</p>
                    <p className="text-xs text-slate-400">{l.days} day(s)</p>
                  </div>
                  <Badge tone={l.status === "approved" ? "green" : l.status === "rejected" ? "red" : "amber"}>{l.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      {loading && <p className="mt-4 text-center text-xs text-slate-400">Refreshing…</p>}
    </div>
  );
}

function AdminDashboard({ role }: { role: string }) {
  const { me } = useMe();
  const currency = me?.settings?.currency ?? "$";
  const isAdmin = role === "company_admin";
  const [stats, setStats] = useState<StatsData | null>(null);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [departments, setDepartments] = useState<SetupItem[] | null>(null);
  const [locations, setLocations] = useState<SetupItem[] | null>(null);
  const [rules, setRules] = useState<RulesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      // Departments / locations are a secondary panel: if they fail the rest of the dashboard still renders.
      const [s, lv, dept, loc, st] = await Promise.all([
        api<StatsData>("/api/admin/stats"),
        api<{ leaves: LeaveRow[] }>("/api/leaves"),
        isAdmin ? api<{ departments: SetupItem[] }>("/api/departments").catch(() => null) : Promise.resolve(null),
        isAdmin ? api<{ locations: SetupItem[] }>("/api/locations").catch(() => null) : Promise.resolve(null),
        isAdmin ? api<{ settings: RulesSummary | null }>("/api/settings").catch(() => null) : Promise.resolve(null),
      ]);
      setStats(s);
      setLeaves(lv.leaves);
      setDepartments(dept ? dept.departments : null);
      setLocations(loc ? loc.locations : null);
      setRules(st?.settings ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the dashboard");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, action: "approve" | "reject") => {
    setProcessing(id);
    try {
      await api(`/api/leaves/${id}`, { method: "PATCH", body: JSON.stringify({ action }) });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Action failed");
    } finally {
      setProcessing("");
    }
  };

  const pendingLeaves = leaves.filter((l) => l.status === "pending");

  return (
    <div>
      <PageHeader
        title="Admin Dashboard"
        subtitle={stats ? `Overview for ${formatDate(stats.today.date)}` : "Company overview"}
        action={
          <Link href="/reports">
            <Button variant="secondary" size="sm">View Reports</Button>
          </Link>
        }
      />

      {error && <ErrorBanner message={error} onRetry={load} />}

      {isAdmin && (departments || locations || rules) && (
        <div className="mb-4">
          {((departments && departments.length === 0) || (locations && locations.length === 0)) && (
            <p className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              Finish setting up your company: add at least one department and one work location before adding employees.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SetupCard
              title="Departments"
              noun="department"
              items={departments}
              href="/departments"
              addLabel="+ Add department"
            />
            <SetupCard
              title="Locations"
              noun="location"
              items={locations}
              href="/locations"
              addLabel="+ Add location"
            />
            <RulesCard rules={rules} />
          </div>
        </div>
      )}

      {loading && !stats ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Employees" value={stats.today.totalEmployees} tone="indigo" />
            <StatCard label="Present" value={stats.today.present} tone="emerald" />
            <StatCard label="Absent" value={stats.today.absent} tone="rose" />
            <StatCard label="On Leave" value={stats.today.onLeave} tone="sky" />
            <StatCard label="Late" value={stats.today.late} tone="amber" />
            <StatCard label="Pending Leaves" value={stats.today.pendingLeaves} tone="slate" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="mb-3 font-bold text-slate-900">Monthly Salary Overview</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-indigo-50 p-4">
                  <p className="text-lg font-bold text-indigo-700">{currency}{formatNumber(stats.month.totalPayroll)}</p>
                  <p className="text-xs font-semibold text-indigo-500">Total payroll</p>
                </div>
                <div className="rounded-xl bg-rose-50 p-4">
                  <p className="text-lg font-bold text-rose-700">{currency}{formatNumber(stats.month.totalDeductions)}</p>
                  <p className="text-xs font-semibold text-rose-500">Total deductions</p>
                </div>
              </div>
            </Card>
            <Card>
              <h3 className="mb-3 font-bold text-slate-900">Pending Leave Approvals</h3>
              {pendingLeaves.length === 0 ? (
                <EmptyState message="No pending approvals 🎉" />
              ) : (
                <div className="space-y-2">
                  {pendingLeaves.slice(0, 4).map((l) => (
                    <div key={l.id} className="rounded-xl border border-slate-100 p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-bold text-slate-800">{l.employeeName}</p>
                          <p className="text-xs text-slate-500">{formatDate(l.startDate)} → {formatDate(l.endDate)} · {l.days} day(s)</p>
                        </div>
                        <Badge tone="amber">{l.currentLevel === 2 ? "Level 2" : "Level 1"}</Badge>
                      </div>
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" variant="success" loading={processing === l.id} onClick={() => decide(l.id, "approve")}>Approve</Button>
                        <Button size="sm" variant="danger" loading={processing === l.id} onClick={() => decide(l.id, "reject")}>Reject</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      ) : null}

      {role === "manager" && (
        <p className="mt-4 rounded-xl bg-sky-50 px-4 py-3 text-xs font-medium text-sky-700">
          You can approve Level 1 leave requests for your team. Final approvals are handled by the company admin.
        </p>
      )}
    </div>
  );
}

function SetupCard({
  title,
  noun,
  items,
  href,
  addLabel,
}: {
  title: string;
  noun: string;
  items: SetupItem[] | null;
  href: string;
  addLabel: string;
}) {
  const total = items?.length ?? 0;
  const active = items?.filter((i) => i.isActive).length ?? 0;
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500">
            {items === null
              ? "Could not load"
              : total === 0
                ? `No ${noun}s yet`
                : `${total} ${noun}${total === 1 ? "" : "s"} · ${active} active`}
          </p>
        </div>
        <Link href={href}>
          <Button size="sm">{total === 0 ? addLabel : "Manage"}</Button>
        </Link>
      </div>
      {items && total > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {items.slice(0, 6).map((i) => (
            <span
              key={i.id}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${i.isActive ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-400"}`}
            >
              {i.name}
            </span>
          ))}
          {total > 6 && <span className="px-1 py-1 text-xs font-semibold text-slate-400">+{total - 6} more</span>}
        </div>
      )}
      {items && total > 0 && (
        <Link href={href} className="mt-3 inline-block text-xs font-semibold text-indigo-600 hover:underline">
          {addLabel} →
        </Link>
      )}
    </Card>
  );
}


function RulesCard({ rules }: { rules: RulesSummary | null }) {
  const cycle =
    !rules || rules.salaryCycleStartDay <= 1
      ? "Calendar-month salary cycle"
      : `Salary cycle: day ${rules.salaryCycleStartDay} → ${rules.salaryCycleStartDay - 1}`;
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-bold text-slate-900">Rules</h3>
          <p className="text-xs text-slate-500">{rules ? "Attendance, deductions & salary cycle" : "Could not load"}</p>
        </div>
        <Link href="/rules">
          <Button size="sm">Manage</Button>
        </Link>
      </div>
      {rules && (
        <ul className="mt-3 space-y-1 text-xs text-slate-600">
          <li>{rules.graceMinutes}-minute cool-off · half day after {rules.lateThresholdMinutes} min late</li>
          <li>{cycle}</li>
          <li>
            Overtime {rules.overtimeEnabled ? "on" : "off"} · late-marks rule {rules.lateMarksLimit > 0 ? `every ${rules.lateMarksLimit}` : "off"}
          </li>
        </ul>
      )}
    </Card>
  );
}
