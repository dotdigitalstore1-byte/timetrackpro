"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, useMe } from "@/lib/client";
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatCard } from "@/components/ui";
import PunchCard from "@/components/PunchCard";
import { formatDate, formatDayKey, formatNumber, monthLabel } from "@/lib/utils";
import { attendanceCounts } from "@/lib/attendance-stats";

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
  period?: { start: string; end: string };
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

interface PendingLeave {
  id: string;
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: string;
  reason: string | null;
  currentLevel: number;
}

interface DashboardData {
  viewer: { role: string; permissions: string[] };
  today: {
    date: string;
    isOffDay: boolean;
    totalEmployees: number;
    present: number;
    clockedIn: number;
    absent: number;
    onLeave: number;
    late: number;
    halfDay: number;
    pendingLeaves: number;
  };
  cycle: { label: string; lateMarks: number; halfDays: number; absentDays: number; leaveDays: number };
  pendingLeaves: PendingLeave[];
  setup?: {
    departments: { total: number; active: number };
    locations: { total: number; active: number };
    managers: { total: number; active: number; withoutDepartment: number };
    employeesWithoutDepartment: number;
    employeesWithoutLocation: number;
    rules: {
      graceMinutes: number;
      lateThresholdMinutes: number;
      salaryCycleStartDay: number;
      overtimeEnabled: boolean;
      lateMarksLimit: number;
      approvalLevels: number;
    };
  };
  team?: { size: number; departments: string[]; locationCount: number };
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
    <StaffDashboard role={me.user.role} />
  ) : (
    <EmployeeDashboard />
  );
}

function EmployeeDashboard() {
  const { me } = useMe();
  const [records, setRecords] = useState<AttendanceRow[]>([]);
  const [cyclePeriod, setCyclePeriod] = useState<{ start: string; end: string } | null>(null);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [salary, setSalary] = useState<SalaryData | null>(null);
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [att, lv, sal] = await Promise.all([
        api<{ records: AttendanceRow[]; period?: { start: string; end: string } }>(`/api/attendance`),
        api<{ leaves: LeaveRow[]; balance: LeaveBalance | null }>("/api/leaves"),
        api<SalaryData>(`/api/salary`),
      ]);
      setRecords(att.records);
      setCyclePeriod(att.period ?? null);
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

  // Same counts as the Attendance page (src/lib/attendance-stats.ts).
  const counts = attendanceCounts(records);

  return (
    <div>
      <PageHeader title={`Welcome back, ${me?.user.fullName.split(" ")[0] ?? ""}`} subtitle={me?.employee?.designation || "Employee"} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PunchCard onChanged={load} />
        </div>
        <div className="space-y-4">
          <Card>
            <h3 className="font-bold text-slate-900">This Salary Cycle</h3>
            <p className="mb-3 text-xs text-slate-500">
              {cyclePeriod ? `${formatDayKey(cyclePeriod.start)} – ${formatDayKey(cyclePeriod.end)}` : "Current cycle"}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-emerald-50 p-3 text-center">
                <p className="text-xl font-bold text-emerald-700">{counts.present}</p>
                <p className="text-[10px] font-bold uppercase text-emerald-600">Present</p>
              </div>
              <div className="rounded-xl bg-amber-50 p-3 text-center">
                <p className="text-xl font-bold text-amber-700">{counts.late}</p>
                <p className="text-[10px] font-bold uppercase text-amber-600">Late</p>
              </div>
              <div className="rounded-xl bg-rose-50 p-3 text-center">
                <p className="text-xl font-bold text-rose-700">{counts.half}</p>
                <p className="text-[10px] font-bold uppercase text-rose-600">Half day</p>
              </div>
              <div className="rounded-xl bg-slate-100 p-3 text-center">
                <p className="text-xl font-bold text-slate-600">{counts.absent}</p>
                <p className="text-[10px] font-bold uppercase text-slate-500">No punch</p>
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
            <h3 className="mb-2 font-bold text-slate-900">Salary This Cycle</h3>
            {salary ? (
              <>
                <p className="text-2xl font-bold text-emerald-600">
                  {me?.settings?.currency ?? "$"}
                  {formatNumber(salary.breakdown.netPayable)}
                </p>
                <p className="text-xs text-slate-500">{salary.period ? `${formatDayKey(salary.period.start)} – ${formatDayKey(salary.period.end)}` : monthLabel(salary.year, salary.month)} · net payable</p>
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
            <EmptyState message="No attendance records in this salary cycle." />
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

function StaffDashboard({ role }: { role: string }) {
  const { me } = useMe();
  const isAdmin = role === "company_admin";
  const canApprove = isAdmin || (me?.access.permissions.includes("approve_leaves") ?? false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setData(await api<DashboardData>("/api/dashboard"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

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

  const t = data?.today;
  const setupIssues = isAdmin && data?.setup
    ? [
        data.setup.departments.total === 0 && "Add a department",
        data.setup.locations.total === 0 && "Add a work location",
        data.setup.employeesWithoutDepartment > 0 && `${data.setup.employeesWithoutDepartment} employee(s) have no department`,
        data.setup.employeesWithoutLocation > 0 && `${data.setup.employeesWithoutLocation} employee(s) have no work location`,
        data.setup.managers.withoutDepartment > 0 && `${data.setup.managers.withoutDepartment} manager(s) have no department`,
      ].filter(Boolean) as string[]
    : [];

  return (
    <div>
      <PageHeader
        title={isAdmin ? "Admin Dashboard" : "Manager Dashboard"}
        subtitle={t ? `${formatDate(t.date)}${t.isOffDay ? " · Off day" : ""}` : "Company overview"}
        action={
          isAdmin || me?.access.permissions.includes("view_reports") ? (
            <Link href="/reports">
              <Button variant="secondary" size="sm">View Reports</Button>
            </Link>
          ) : undefined
        }
      />

      {error && <ErrorBanner message={error} onRetry={load} />}

      {setupIssues.length > 0 && (
        <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Finish setting up</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {setupIssues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      )}

      {loading && !data ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : data && t ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            <StatCard label={isAdmin ? "Employees" : "Team"} value={t.totalEmployees} tone="indigo" />
            <StatCard label="Present today" value={t.present} tone="emerald" />
            <StatCard label="Clocked in now" value={t.clockedIn} tone="emerald" />
            <StatCard label="Absent" value={t.absent} tone="rose" />
            <StatCard label="On leave" value={t.onLeave} tone="sky" />
            <StatCard label="Late" value={t.late} tone="amber" />
            <StatCard label="Half day" value={t.halfDay} tone="amber" />
            <StatCard label="Pending approvals" value={t.pendingLeaves} tone="slate" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <h3 className="font-bold text-slate-900">Salary cycle so far</h3>
              <p className="mb-3 text-xs text-slate-500">{data.cycle.label}</p>
              <div className="grid grid-cols-2 gap-2">
                <MiniStat label="Late marks" value={data.cycle.lateMarks} tone="text-amber-700 bg-amber-50" />
                <MiniStat label="Half days" value={data.cycle.halfDays} tone="text-amber-700 bg-amber-50" />
                <MiniStat label="Absent days" value={data.cycle.absentDays} tone="text-rose-700 bg-rose-50" />
                <MiniStat label="Leave days" value={data.cycle.leaveDays} tone="text-sky-700 bg-sky-50" />
              </div>
              <p className="mt-3 text-[11px] text-slate-400">Counted the same way as payroll. Salary figures are on the Salary page.</p>
            </Card>

            <Card className="lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-bold text-slate-900">Pending leave approvals</h3>
                <Link href="/leaves" className="text-xs font-semibold text-indigo-600 hover:underline">All leaves →</Link>
              </div>
              {data.pendingLeaves.length === 0 ? (
                <EmptyState message="No pending approvals 🎉" />
              ) : (
                <div className="space-y-2">
                  {data.pendingLeaves.slice(0, 5).map((l) => (
                    <div key={l.id} className="rounded-xl border border-slate-100 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-slate-800">{l.employeeName}</p>
                          <p className="text-xs text-slate-500">
                            {formatDate(l.startDate)} → {formatDate(l.endDate)} · {l.days} day(s) · {l.leaveType === "medical" ? "Medical" : "Casual"}
                          </p>
                        </div>
                        <Badge tone="amber">{data.setup?.rules.approvalLevels === 2 && l.currentLevel === 2 ? "Final approval" : "Pending"}</Badge>
                      </div>
                      {canApprove && (
                        <div className="mt-2 flex gap-2">
                          <Button size="sm" variant="success" loading={processing === l.id} onClick={() => decide(l.id, "approve")}>Approve</Button>
                          <Button size="sm" variant="danger" loading={processing === l.id} onClick={() => decide(l.id, "reject")}>Reject</Button>
                        </div>
                      )}
                    </div>
                  ))}
                  {data.pendingLeaves.length > 5 && (
                    <Link href="/leaves" className="block text-center text-xs font-semibold text-indigo-600 hover:underline">
                      +{data.pendingLeaves.length - 5} more
                    </Link>
                  )}
                </div>
              )}
            </Card>
          </div>

          {isAdmin && data.setup && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SetupCard
                title="Departments"
                noun="department"
                total={data.setup.departments.total}
                active={data.setup.departments.active}
                href="/departments"
                addLabel="+ Add department"
              />
              <SetupCard
                title="Locations"
                noun="location"
                total={data.setup.locations.total}
                active={data.setup.locations.active}
                href="/locations"
                addLabel="+ Add location"
              />
              <SetupCard
                title="Managers"
                noun="manager"
                total={data.setup.managers.total}
                active={data.setup.managers.active}
                href="/managers"
                addLabel="+ Add manager"
              />
              <RulesCard rules={data.setup.rules} />
            </div>
          )}

          {!isAdmin && data.team && (
            <Card className="mt-4">
              <h3 className="font-bold text-slate-900">Your team</h3>
              <p className="mt-1 text-sm text-slate-600">
                {data.team.size} employee{data.team.size === 1 ? "" : "s"}
                {data.team.departments.length ? ` in ${data.team.departments.join(", ")}` : ""}
                {data.team.locationCount ? ` · ${data.team.locationCount} work location(s)` : ""}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Your powers are set by your company admin. Anything outside your team or your powers is hidden from you.
              </p>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl p-3 text-center ${tone}`}>
      <p className="text-xl font-bold">{value}</p>
      <p className="text-[10px] font-bold uppercase">{label}</p>
    </div>
  );
}

function SetupCard({
  title,
  noun,
  total,
  active,
  href,
  addLabel,
}: {
  title: string;
  noun: string;
  total: number;
  active: number;
  href: string;
  addLabel: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500">
            {total === 0 ? `No ${noun}s yet` : `${total} ${noun}${total === 1 ? "" : "s"} · ${active} active`}
          </p>
        </div>
        <Link href={href}>
          <Button size="sm">{total === 0 ? addLabel : "Manage"}</Button>
        </Link>
      </div>
    </Card>
  );
}

function RulesCard({ rules }: { rules: NonNullable<NonNullable<DashboardData["setup"]>["rules"]> }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-bold text-slate-900">Attendance rules</h3>
          <p className="text-xs text-slate-500">Late, half-day and overtime rules</p>
        </div>
        <Link href="/rules">
          <Button size="sm">Manage</Button>
        </Link>
      </div>
      <ul className="mt-3 space-y-1 text-xs text-slate-600">
        <li>{rules.graceMinutes}-minute cool-off · half day after {rules.lateThresholdMinutes} min late</li>
        <li>Overtime {rules.overtimeEnabled ? "on" : "off"} · late-marks rule {rules.lateMarksLimit > 0 ? `every ${rules.lateMarksLimit}` : "off"}</li>
        <li>Approval: {rules.approvalLevels === 2 ? "manager, then admin" : "single approver"}</li>
      </ul>
    </Card>
  );
}
