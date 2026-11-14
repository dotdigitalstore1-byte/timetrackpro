"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, useMe } from "@/lib/client";
import { Badge, Button, Card, EmptyState, ErrorBanner, Skeleton, Spinner } from "@/components/ui";
import PunchCard from "@/components/PunchCard";
import { formatDate, formatDayKey, formatNumber, formatTime, monthLabel, CURRENCY } from "@/lib/utils";
import { EMPTY_CYCLE_COUNTS, calendarTone, statusLabel, statusTone, type CycleCounts } from "@/lib/attendance-stats";
import { weekdayOf } from "@/lib/attendance-days";

interface AttendanceRow {
  id: string;
  employeeName: string;
  workDate: string;
  punchInTime: string | null;
  punchOutTime: string | null;
  status: string;
}

/** One calendar date of the cycle: the stored record if there is one, otherwise its status (Sunday, Leave, Absent...). */
interface CalendarDayRow {
  date: string; // YYYY-MM-DD
  weekday: string;
  kind: string;
  label: string;
  note: string;
  record: AttendanceRow | null;
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
  employeeCode?: string | null;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: string;
  reason: string | null;
  currentLevel: number;
}


interface RosterRow {
  employeeId: string;
  name: string;
  code: string | null;
  state: string;
  punchInTime: string | null;
  punchOutTime: string | null;
  clockedIn: boolean;
  shiftStart: string;
  shiftEnd: string;
}

interface RangeRow {
  employeeId: string;
  name: string;
  code: string | null;
  present: number;
  late: number;
  halfDay: number;
  absent: number;
  onLeave: number;
}

interface DashboardData {
  viewer: { role: string; permissions: string[] };
  range: { key: RangeKey; label: string; start: string; end: string; live: boolean };
  generatedAt: string;
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
    waiting: number;
    pendingLeaves: number;
  };
  summary: { present: number; late: number; halfDay: number; absent: number; onLeave: number; totalEmployees: number };
  roster: RosterRow[];
  rows: RangeRow[];
  cycle: { label: string; lateMarks: number; halfDays: number; absentDays: number; leaveDays: number };
  pendingLeaves: PendingLeave[];
  payroll?: { label: string; activeEmployees: number; draft: number; finalized: number; paid: number; notCalculated: number };
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
      absentAfterPercent: number | null;
    };
  };
  team?: { size: number; departments: string[]; locationCount: number };
}

type RangeKey = "daily" | "7d" | "30d" | "cycle";

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
  const [days, setDays] = useState<CalendarDayRow[]>([]);
  const [summary, setSummary] = useState<CycleCounts>(EMPTY_CYCLE_COUNTS);
  const [today, setToday] = useState<string>("");
  const [cyclePeriod, setCyclePeriod] = useState<{ start: string; end: string } | null>(null);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [salary, setSalary] = useState<SalaryData | null>(null);
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => new Date());
  const [notice, setNotice] = useState<{ status: string; phase: string | null; daysLeft: number | null; lastWorkingDay: string | null; noticeDays: number | null } | null>(null);

  const load = useCallback(async () => {
    setError("");
    // The notice banner is optional: a failure here must not break the dashboard.
    api<{ current: typeof notice }>("/api/notice").then((n) => setNotice(n.current ?? null)).catch(() => setNotice(null));
    try {
      const [att, lv, sal] = await Promise.all([
        api<{
          records: AttendanceRow[];
          days: CalendarDayRow[] | null;
          summary: CycleCounts;
          period?: { start: string; end: string };
          today?: string;
        }>(`/api/attendance`),
        api<{ leaves: LeaveRow[]; balance: LeaveBalance | null }>("/api/leaves"),
        api<SalaryData>(`/api/salary`),
      ]);
      setRecords(att.records);
      setDays(att.days ?? []);
      setSummary(att.summary ?? EMPTY_CYCLE_COUNTS);
      setToday(att.today ?? "");
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

  // The clock drives the shift progress bar; it updates once a minute.
  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const todayRec = records.find((r) => r.workDate.slice(0, 10) === today) ?? null;
  const shiftStart = me?.employee?.shiftStart ?? me?.settings?.shiftStart ?? "09:00";
  const shiftEnd = me?.employee?.shiftEnd ?? me?.settings?.shiftEnd ?? "18:00";
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const nowMin = clock.getHours() * 60 + clock.getMinutes();
  const startMin = toMin(shiftStart);
  const span = Math.max(1, toMin(shiftEnd) - startMin);
  // Position (0-100%) of a clock time along the shift.
  const pct = (m: number) => Math.min(100, Math.max(0, ((m - startMin) / span) * 100));
  const progress = pct(nowMin);

  // Shift timeline. RED = the time the employee was late: from shift start up to the punch-in
  // (or up to now while not punched in yet). GREEN = the time worked after punching in, up to punch-out or now.
  const minutesOf = (iso: string) => {
    const d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes();
  };
  const punchInMin = todayRec?.punchInTime ? minutesOf(todayRec.punchInTime) : null;
  const punchOutMin = todayRec?.punchOutTime ? minutesOf(todayRec.punchOutTime) : null;
  const wasLate = punchInMin !== null && todayRec?.status !== "present";
  const lateMinutes = wasLate && punchInMin !== null ? Math.max(0, punchInMin - startMin) : 0;
  const redFrom = startMin;
  const redTo = punchInMin === null ? nowMin : wasLate ? punchInMin : startMin;
  const greenFrom = punchInMin === null ? null : wasLate ? punchInMin : startMin;
  const greenTo = punchOutMin ?? nowMin;
  const segStyle = (from: number, to: number) => ({
    left: `${pct(from)}%`,
    width: `${Math.max(0, pct(to) - pct(from))}%`,
  });

  // Recent days: the latest 7 dates of this cycle up to today, with no gaps. Future dates are not "recent".
  const recentDays = days.filter((d) => d.date <= today).slice(0, 7);
  const firstName = (me?.user.fullName ?? "").split(" ")[0];
  const hour = clock.getHours();
  const hi = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // Today, in one sentence the employee can read at a glance.
  const todayState = !todayRec?.punchInTime
    ? { tone: "slate" as const, title: "Not punched in yet", hint: `Punch in from your work location. Shift starts at ${shiftStart}.` }
    : !todayRec.punchOutTime
      ? { tone: todayRec.status === "present" ? ("green" as const) : todayRec.status === "late" ? ("amber" as const) : ("red" as const), title: `Working since ${formatTime(todayRec.punchInTime)}`, hint: `Remember to punch out at the end of your shift (${shiftEnd}).` }
      : { tone: "green" as const, title: "Done for today", hint: `${formatTime(todayRec.punchInTime)} – ${formatTime(todayRec.punchOutTime)}` };

  const tones = {
    green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    red: "bg-rose-50 text-rose-800 ring-rose-200",
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
  } as const;

  return (
    <div className="pb-10">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">{me?.employee?.designation || "Employee"}</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {firstName ? `${hi}, ${firstName}` : hi}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {clock.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          <span>{error}</span>
          <button type="button" onClick={load} className="font-bold underline">Try again</button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* ---- primary column: today and punching */}
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Today</p>
                <p className="mt-1 text-xl font-bold text-slate-900">{todayState.title}</p>
                <p className="mt-0.5 text-sm text-slate-500">{todayState.hint}</p>
              </div>
              {todayRec?.punchInTime && (
                <span className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-bold ring-1 ${tones[todayState.tone]}`}>
                  {statusLabel(todayRec.status)}
                </span>
              )}
            </div>
            <div className="mt-5">
              <div className="mb-1.5 flex justify-between text-[11px] font-semibold text-slate-500">
                <span>{shiftStart}</span>
                <span>{Math.round(progress)}% of shift</span>
                <span>{shiftEnd}</span>
              </div>
              <div className="relative h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Shift timeline: ${Math.round(progress)}% elapsed`}>
                {redTo > redFrom && <div className="absolute inset-y-0 rounded-full bg-rose-500 transition-all" style={segStyle(redFrom, redTo)} />}
                {greenFrom !== null && <div className="absolute inset-y-0 rounded-full bg-emerald-500 transition-all" style={segStyle(greenFrom, greenTo)} />}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-slate-500">
                {redTo > redFrom && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-rose-500" aria-hidden="true" />
                    {punchInMin === null ? "Late so far" : `Late by ${lateMinutes} min`}
                  </span>
                )}
                {greenFrom !== null && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                    {punchOutMin === null ? "Worked since punch-in" : "Worked"}
                  </span>
                )}
              </div>
            </div>
          </Card>

          {notice?.status === "active" && notice.phase !== "ended" && (
            <Card className="border-indigo-200 bg-indigo-50/60 p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-indigo-600">Serving notice</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {notice.phase === "upcoming" ? "Your notice period starts soon." : `${notice.daysLeft ?? 0} day${notice.daysLeft === 1 ? "" : "s"} left in your notice period.`}
              </p>
              <p className="mt-0.5 text-xs text-slate-600">Last working day: {formatDayKey(notice.lastWorkingDay)}. Keep punching in and out as usual.</p>
            </Card>
          )}

          <PunchCard onChanged={load} />

          {/* ---- this cycle */}
          <Card className="p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="font-bold text-slate-900">This salary cycle</h2>
                <p className="text-xs text-slate-500">
                  {cyclePeriod ? `${formatDayKey(cyclePeriod.start)} – ${formatDayKey(cyclePeriod.end)}` : "Current cycle"}
                </p>
              </div>
              <Link href="/attendance" className="text-xs font-semibold text-indigo-600 hover:underline">Full attendance →</Link>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <CycleTile label="Present" value={summary.present} tone="text-emerald-700" bg="bg-emerald-50" />
              <CycleTile label="Late" value={summary.late} tone="text-amber-700" bg="bg-amber-50" />
              <CycleTile label="Half day" value={summary.half} tone="text-orange-700" bg="bg-orange-50" />
              <CycleTile label="Leaves" value={summary.leave} tone="text-sky-700" bg="bg-sky-50" />
            </div>
          </Card>

          {/* ---- recent days: every calendar date, no gaps (today and the days before it, in this cycle) */}
          <Card className="p-0">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="font-bold text-slate-900">Recent days</h2>
              <Link href="/attendance" className="text-xs font-semibold text-indigo-600 hover:underline">View all →</Link>
            </div>
            {recentDays.length === 0 ? (
              <div className="p-6"><EmptyState message="No days in this salary cycle yet." /></div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recentDays.map((d) => {
                  const r = d.record;
                  return (
                    <li key={d.date} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">
                          {formatDayKey(d.date)} <span className="font-normal text-slate-400">· {weekdayOf(d.date)}</span>
                        </p>
                        <p className="text-xs text-slate-500">
                          {r
                            ? `${r.punchInTime ? `In ${formatTime(r.punchInTime)}` : "No punch-in"}${r.punchOutTime ? ` · Out ${formatTime(r.punchOutTime)}` : ""}`
                            : d.note}
                        </p>
                      </div>
                      {r ? (
                        <Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge>
                      ) : (
                        <Badge tone={calendarTone(d.kind)}>{d.label}</Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        {/* ---- side column: leave, pay, shift */}
        <div className="min-w-0 space-y-5">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold text-slate-900">Leave</h2>
              <Link href="/leaves" className="text-xs font-semibold text-indigo-600 hover:underline">Request →</Link>
            </div>
            {balance ? (
              <>
                <div className="flex items-end gap-2">
                  <p className="text-4xl font-bold tracking-tight text-indigo-600">{balance.remaining}</p>
                  <p className="pb-1 text-sm text-slate-500">of {balance.quota} days left this year</p>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-indigo-500" style={{ width: `${balance.quota ? Math.min(100, (balance.remaining / balance.quota) * 100) : 0}%` }} />
                </div>
                <div className="mt-2.5 flex justify-between text-xs text-slate-500">
                  <span>{balance.used} used</span>
                  <span className={balance.pending ? "font-semibold text-amber-700" : ""}>{balance.pending} pending</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-400">No leave quota set by your company.</p>
            )}
            {leaves.length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                {leaves.slice(0, 3).map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate text-slate-600">{formatDate(l.startDate)} · {l.days} day(s)</span>
                    <Badge tone={l.status === "approved" ? "green" : l.status === "rejected" ? "red" : "amber"}>{l.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="font-bold text-slate-900">Salary this cycle</h2>
              <Link href="/salary" className="text-xs font-semibold text-indigo-600 hover:underline">Details →</Link>
            </div>
            {salary ? (
              <>
                <p className="text-xs text-slate-500">
                  {salary.period ? `${formatDayKey(salary.period.start)} – ${formatDayKey(salary.period.end)}` : monthLabel(salary.year, salary.month)}
                </p>
                <p className="mt-3 text-3xl font-bold tracking-tight text-emerald-600">
                  {CURRENCY}
                  {formatNumber(salary.breakdown.netPayable)}
                </p>
                <p className="text-xs text-slate-500">Net payable so far</p>
                <dl className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
                  <div className="flex justify-between"><dt className="text-slate-500">Attendance salary</dt><dd className="font-semibold text-slate-800">{CURRENCY}{formatNumber(salary.breakdown.attendanceSalary)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Deductions</dt><dd className="font-semibold text-rose-600">−{CURRENCY}{formatNumber(salary.breakdown.totalDeductions)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Salary delayed (unapproved leave)</dt><dd className="font-semibold text-amber-700">{salary.breakdown.salaryHoldDays} days</dd></div>
                </dl>
                <Link href="/salary" className="mt-4 block rounded-xl bg-slate-50 px-3 py-2.5 text-center text-xs font-semibold text-slate-700 hover:bg-slate-100">
                  Request a salary slip
                </Link>
              </>
            ) : (
              <div className="py-6 text-center text-sm text-slate-400">Loading…</div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 font-bold text-slate-900">My work</h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-slate-400">Shift</dt>
                <dd className="font-semibold text-slate-800">
                  {shiftStart} – {shiftEnd}
                  {me?.settings && me.settings.graceMinutes > 0 ? <span className="font-normal text-slate-500"> · {me.settings.graceMinutes} min cool-off</span> : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Department</dt>
                <dd className="font-semibold text-slate-800">{me?.employee?.departments.map((d) => d.name).join(", ") || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Work location</dt>
                <dd className="font-semibold text-slate-800">
                  {me?.employee?.locations.length ? me.employee.locations.map((l) => l.name).join(", ") : "Any company location"}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
      {loading && !records.length && <p className="mt-6 text-center text-xs text-slate-400">Loading your day…</p>}
    </div>
  );
}

function CycleTile({ label, value, tone, bg }: { label: string; value: number; tone: string; bg: string }) {
  return (
    <div className={`rounded-xl px-3 py-3 ${bg}`}>
      <p className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
      <p className="text-xs font-semibold text-slate-600">{label}</p>
    </div>
  );
}

const RANGE_TABS: { key: RangeKey; label: string; hint: string }[] = [
  { key: "daily", label: "Today", hint: "Live" },
  { key: "7d", label: "7 days", hint: "Last 7 days" },
  { key: "30d", label: "30 days", hint: "Last 30 days" },
  { key: "cycle", label: "Salary cycle", hint: "Payroll period" },
];

type StateKey = "present" | "late" | "half_day" | "absent" | "on_leave" | "waiting" | "off" | "not_started";

const STATE_META: Record<StateKey, { label: string; dot: string; chip: string; bar: string }> = {
  present: { label: "On time", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", bar: "bg-emerald-500" },
  late: { label: "Late", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-800 ring-amber-200", bar: "bg-amber-400" },
  half_day: { label: "Half day", dot: "bg-orange-500", chip: "bg-orange-50 text-orange-800 ring-orange-200", bar: "bg-orange-400" },
  absent: { label: "Absent", dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700 ring-rose-200", bar: "bg-rose-500" },
  on_leave: { label: "On leave", dot: "bg-sky-500", chip: "bg-sky-50 text-sky-700 ring-sky-200", bar: "bg-sky-400" },
  waiting: { label: "Not punched yet", dot: "bg-indigo-400", chip: "bg-indigo-50 text-indigo-700 ring-indigo-200", bar: "bg-indigo-200" },
  off: { label: "Off day", dot: "bg-slate-300", chip: "bg-slate-100 text-slate-600 ring-slate-200", bar: "bg-slate-200" },
  not_started: { label: "Not started", dot: "bg-slate-300", chip: "bg-slate-100 text-slate-600 ring-slate-200", bar: "bg-slate-200" },
};

const meta = (state: string) => STATE_META[state as StateKey] ?? STATE_META.off;

const ROSTER_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "absent", label: "Absent" },
  { key: "late", label: "Late" },
  { key: "half_day", label: "Half day" },
  { key: "present", label: "On time" },
  { key: "on_leave", label: "On leave" },
  { key: "waiting", label: "Not punched yet" },
];

/** Live refresh for the Today view. One small request per refresh keeps load low at the morning peak. */
const LIVE_REFRESH_MS = 30_000;

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Share of scheduled days that were worked (on time, late or half day). Null when nothing is scheduled yet. */
function attendanceRate(r: { present: number; late: number; halfDay: number; absent: number }): number | null {
  const scheduled = r.present + r.late + r.halfDay + r.absent;
  return scheduled === 0 ? null : Math.round(((r.present + r.late + r.halfDay) / scheduled) * 100);
}

/** Most urgent first, so the people who need a look are always at the top of the roster. */
const STATE_PRIORITY: Record<string, number> = { absent: 0, late: 1, half_day: 2, waiting: 3, on_leave: 4, present: 5, off: 6, not_started: 7 };

type SortKey = "absent" | "late" | "rate" | "name";
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "absent", label: "Most absences" },
  { value: "late", label: "Most late" },
  { value: "rate", label: "Lowest attendance" },
  { value: "name", label: "Name (A–Z)" },
];

function StaffDashboard({ role }: { role: string }) {
  const { me } = useMe();
  const isAdmin = role === "company_admin";
  const canApprove = isAdmin || (me?.access.permissions.includes("approve_leaves") ?? false);
  const canSeeReports = isAdmin || (me?.access.permissions.includes("view_reports") ?? false);
  const [range, setRange] = useState<RangeKey>("daily");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [processing, setProcessing] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [rosterFilter, setRosterFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("absent");

  const load = useCallback(async (r: RangeKey) => {
    try {
      const next = await api<DashboardData>(`/api/dashboard?range=${r}`);
      setData(next);
      setUpdatedAt(new Date());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [load, range]);

  // Live: the Today view refreshes on an interval and whenever the tab becomes visible again.
  useEffect(() => {
    if (range !== "daily") return;
    const tick = () => {
      if (document.visibilityState === "visible") void load("daily");
    };
    const id = window.setInterval(tick, LIVE_REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [range, load]);

  const decide = async (id: string, action: "approve" | "reject") => {
    setProcessing(id);
    setActionError("");
    try {
      await api(`/api/leaves/${id}`, { method: "PATCH", body: JSON.stringify({ action }) });
      await load(range);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setProcessing("");
    }
  };

  const showGroup = (key: string) => {
    setRange("daily");
    setRosterFilter(key);
    window.setTimeout(() => document.getElementById("roster")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  const t = data?.today;
  const s = data?.summary;
  const firstName = (me?.user.fullName ?? "").split(" ")[0];

  const setupIssues = isAdmin && data?.setup
    ? [
        data.setup.departments.total === 0 && { text: "Add your first department", href: "/departments" },
        data.setup.locations.total === 0 && { text: "Add your first work location", href: "/locations" },
        data.setup.employeesWithoutDepartment > 0 && { text: `${data.setup.employeesWithoutDepartment} employee(s) without a department`, href: "/employees" },
        data.setup.employeesWithoutLocation > 0 && { text: `${data.setup.employeesWithoutLocation} employee(s) without a work location`, href: "/employees" },
        data.setup.managers.withoutDepartment > 0 && { text: `${data.setup.managers.withoutDepartment} manager(s) without a department`, href: "/managers" },
      ].filter(Boolean) as { text: string; href: string }[]
    : [];

  const q = query.trim().toLowerCase();
  const matches = (name: string, code: string | null) => !q || name.toLowerCase().includes(q) || (code ?? "").toLowerCase().includes(q);
  const roster = data?.roster ?? [];
  const rosterCount = (key: string) => roster.filter((r) => key === "all" || r.state === key).length;
  const visibleRoster = roster
    .filter((r) => (rosterFilter === "all" || r.state === rosterFilter) && matches(r.name, r.code))
    .sort((a, b) => (STATE_PRIORITY[a.state] ?? 9) - (STATE_PRIORITY[b.state] ?? 9) || a.name.localeCompare(b.name));
  const visibleRows = (data?.rows ?? [])
    .filter((r) => matches(r.name, r.code))
    .sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "late") return b.late - a.late || b.absent - a.absent || a.name.localeCompare(b.name);
      if (sortBy === "rate") return (attendanceRate(a) ?? 101) - (attendanceRate(b) ?? 101) || a.name.localeCompare(b.name);
      return b.absent - a.absent || b.late - a.late || a.name.localeCompare(b.name);
    });

  const pendingTotal = t?.pendingLeaves ?? 0;
  const attentionCount = pendingTotal + setupIssues.length;
  const isDaily = range === "daily";

  return (
    <div className="@container pb-10">
      {/* ---- header */}
      <div className="mb-5 flex flex-col gap-3 @xl:flex-row @xl:items-end @xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-indigo-600">{isAdmin ? "Admin" : "Manager"} dashboard</p>
          <h1 className="mt-0.5 truncate text-2xl font-bold tracking-tight text-slate-900 @xl:text-3xl">
            {firstName ? `${greeting()}, ${firstName}` : greeting()}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t ? formatDate(t.date) : ""}
            {t?.isOffDay ? " · Weekly off or holiday today" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSeeReports && (
            <Link href="/reports">
              <Button variant="secondary" size="sm">Reports</Button>
            </Link>
          )}
          <button
            type="button"
            onClick={() => load(range)}
            className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-white px-3 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            {isDaily && <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />}
            {updatedAt ? `${isDaily ? "Live · " : ""}Updated ${formatTime(updatedAt)}` : "Refresh"}
          </button>
        </div>
      </div>

      {/* ---- period selector */}
      <div role="tablist" aria-label="Period" className="mb-5 grid grid-cols-2 gap-1.5 rounded-2xl bg-slate-200/60 p-1.5 @xl:inline-grid @xl:grid-cols-4">
        {RANGE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={range === tab.key}
            onClick={() => {
              if (tab.key === range) return;
              setLoading(true);
              setRosterFilter("all");
              setRange(tab.key);
            }}
            className={`min-h-11 rounded-xl px-4 py-1.5 text-center transition-colors ${
              range === tab.key ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <span className="block text-sm font-bold">{tab.label}</span>
            <span className="block text-[11px] font-medium text-slate-400">{tab.hint}</span>
          </button>
        ))}
      </div>

      {error && <ErrorBanner message={error} onRetry={() => load(range)} />}
      {actionError && <ErrorBanner message={actionError} />}

      {loading && !data ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-52" />
          <Skeleton className="h-28" />
          <Skeleton className="h-72" />
        </div>
      ) : data && t && s ? (
        <div className="space-y-5">
          {/* ---- attendance overview: the headline, the mix, and one clickable tile per state */}
          {(() => {
            const attended = s.present + s.late + s.halfDay;
            const rate = attendanceRate(s);
            const segs: { key: StateKey; n: number }[] = [
              { key: "present", n: s.present },
              { key: "late", n: s.late },
              { key: "half_day", n: s.halfDay },
              { key: "absent", n: s.absent },
              { key: "on_leave", n: s.onLeave },
              ...(isDaily ? [{ key: "waiting" as StateKey, n: t.waiting }] : []),
            ];
            const total = segs.reduce((sum, g) => sum + g.n, 0);
            return (
              <Card className="p-5 @xl:p-6">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-500">{data.range.label}</p>
                    <p className="mt-1 flex items-baseline gap-2">
                      {isDaily ? (
                        <>
                          <span className="text-4xl font-bold tabular-nums tracking-tight text-slate-900">{attended}</span>
                          <span className="text-sm text-slate-500">of {s.totalEmployees} employee{s.totalEmployees === 1 ? "" : "s"} in</span>
                        </>
                      ) : (
                        <>
                          <span className="text-4xl font-bold tabular-nums tracking-tight text-slate-900">{rate === null ? "—" : `${rate}%`}</span>
                          <span className="text-sm text-slate-500">of scheduled days worked</span>
                        </>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {data.range.start === data.range.end ? formatDayKey(data.range.start) : `${formatDayKey(data.range.start)} – ${formatDayKey(data.range.end)}`}
                      {range === "cycle" ? " · counted the same way as payroll" : ""}
                      {!isDaily ? ` · ${s.totalEmployees} employee${s.totalEmployees === 1 ? "" : "s"}` : ""}
                    </p>
                  </div>
                  {isDaily && (
                    <div className="flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800 ring-1 ring-indigo-100">
                      <span className="h-2 w-2 rounded-full bg-indigo-500" aria-hidden="true" />
                      <span>
                        <span className="tabular-nums">{t.clockedIn}</span> working now
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Attendance mix">
                  {total > 0 &&
                    segs.map((g) => (g.n > 0 ? <div key={g.key} className={meta(g.key).bar} style={{ width: `${(g.n / total) * 100}%` }} /> : null))}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2.5 @xl:grid-cols-3 @3xl:grid-cols-6">
                  {segs.map((g) => {
                    const m = meta(g.key);
                    const inner = (
                      <>
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                          <span className={`h-2.5 w-2.5 rounded-sm ${m.bar}`} aria-hidden="true" />
                          {m.label}
                        </span>
                        <span className={`mt-1 block text-2xl font-bold tabular-nums ${g.n > 0 ? "text-slate-900" : "text-slate-300"}`}>{g.n}</span>
                      </>
                    );
                    return isDaily ? (
                      <button
                        key={g.key}
                        type="button"
                        onClick={() => showGroup(g.n > 0 ? g.key : "all")}
                        className="rounded-xl bg-slate-50 px-3.5 py-3 text-left ring-1 ring-slate-100 transition hover:bg-white hover:ring-indigo-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                      >
                        {inner}
                      </button>
                    ) : (
                      <div key={g.key} className="rounded-xl bg-slate-50 px-3.5 py-3 ring-1 ring-slate-100">{inner}</div>
                    );
                  })}
                </div>
                {isDaily && <p className="mt-3 text-xs text-slate-500">Tap a tile to see who is in that group. Absent means no punch-in after the cool-off.</p>}
              </Card>
            );
          })()}

          {/* ---- needs attention: leave requests you can act on, and setup that is still missing */}
          {attentionCount === 0 ? (
            <div className="flex items-center gap-2.5 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
              <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[11px] text-white">✓</span>
              All clear. No leave requests are waiting{isAdmin ? " and your setup is complete" : ""}.
            </div>
          ) : (
            <Card className="p-0">
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <h2 className="font-bold text-slate-900">Needs your attention</h2>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold tabular-nums text-amber-800">{attentionCount}</span>
                </div>
                {pendingTotal > 0 && <Link href="/leaves" className="text-xs font-semibold text-indigo-600 hover:underline">All leave requests</Link>}
              </div>

              {pendingTotal > 0 && (
                <div className="px-5 py-4">
                  <p className="mb-2.5 text-xs font-semibold text-slate-500">
                    {pendingTotal} leave request{pendingTotal === 1 ? "" : "s"} waiting
                  </p>
                  <ul className="grid gap-2.5 @3xl:grid-cols-2">
                    {data.pendingLeaves.slice(0, 4).map((l) => (
                      <li key={l.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-start gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-700">{initials(l.employeeName)}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-900">{l.employeeName}</p>
                            <p className="text-xs text-slate-500">
                              {formatDate(l.startDate)}{l.startDate !== l.endDate ? ` → ${formatDate(l.endDate)}` : ""} · {l.days} day(s) · {l.leaveType === "medical" ? "Medical" : "Casual"}
                            </p>
                            {l.reason && <p className="mt-1 line-clamp-2 text-xs text-slate-500">&ldquo;{l.reason}&rdquo;</p>}
                          </div>
                          {data.setup?.rules.approvalLevels === 2 && l.currentLevel === 2 && <Badge tone="indigo">Final</Badge>}
                        </div>
                        {canApprove && (
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <Button size="sm" variant="success" loading={processing === l.id} onClick={() => decide(l.id, "approve")}>Approve</Button>
                            <Button size="sm" variant="secondary" loading={processing === l.id} onClick={() => decide(l.id, "reject")}>Reject</Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                  {pendingTotal > 4 && (
                    <Link href="/leaves" className="mt-3 block text-center text-xs font-semibold text-indigo-600 hover:underline">
                      +{pendingTotal - 4} more
                    </Link>
                  )}
                </div>
              )}

              {setupIssues.length > 0 && (
                <div className={`px-5 py-4 ${pendingTotal > 0 ? "border-t border-slate-100" : ""}`}>
                  <p className="mb-2.5 text-xs font-semibold text-slate-500">Finish setting up</p>
                  <ul className="grid gap-2 @3xl:grid-cols-2">
                    {setupIssues.map((i) => (
                      <li key={i.text}>
                        <Link href={i.href} className="flex items-center justify-between gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-900 ring-1 ring-amber-100 hover:bg-amber-100">
                          <span>{i.text}</span>
                          <span aria-hidden="true">→</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          )}

          {/* ---- people */}
          <div className="grid items-start gap-5 @4xl:grid-cols-3">
            <div id="roster" className="min-w-0 scroll-mt-20 @4xl:col-span-2">
            <Card className="p-0">
              <div className="flex flex-col gap-3 border-b border-slate-100 p-4 @xl:flex-row @xl:items-center @xl:justify-between @xl:p-5">
                <div className="min-w-0">
                  <h2 className="font-bold text-slate-900">{isDaily ? "Who is in today" : "Attendance by employee"}</h2>
                  <p className="text-xs text-slate-500">
                    {isDaily ? "People who need a look are listed first." : "Weekly offs and holidays are not counted."}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1 @xl:w-56 @xl:flex-none">
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search name or code"
                      aria-label="Search employees"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                  {!isDaily && (
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as SortKey)}
                      aria-label="Sort employees"
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-500"
                    >
                      {SORT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              {isDaily && (
                <div className="flex gap-1.5 overflow-x-auto border-b border-slate-100 px-4 py-3 [-ms-overflow-style:none] [scrollbar-width:none] @xl:px-5 [&::-webkit-scrollbar]:hidden">
                  {ROSTER_FILTERS.filter((f) => f.key === "all" || f.key === rosterFilter || rosterCount(f.key) > 0).map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setRosterFilter(f.key)}
                      aria-pressed={rosterFilter === f.key}
                      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                        rosterFilter === f.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {f.label} <span className="opacity-70">{rosterCount(f.key)}</span>
                    </button>
                  ))}
                </div>
              )}

              {isDaily ? (
                visibleRoster.length === 0 ? (
                  <div className="p-8"><EmptyState message={q ? "No one matches that search." : "Nobody in this group right now."} /></div>
                ) : (
                  <ul className="max-h-[36rem] divide-y divide-slate-100 overflow-y-auto">
                    {visibleRoster.map((r) => {
                      const m = meta(r.state);
                      return (
                        <li key={r.employeeId} className="flex items-center gap-3 px-4 py-3 @xl:px-5">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">{initials(r.name)}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-900">
                              {r.name}
                              {r.code ? <span className="ml-2 font-mono text-[11px] font-normal text-slate-400">{r.code}</span> : null}
                            </p>
                            <p className="truncate text-xs text-slate-500">
                              {r.punchInTime ? `In ${formatTime(r.punchInTime)}` : `Shift starts ${r.shiftStart}`}
                              {r.punchOutTime ? ` · Out ${formatTime(r.punchOutTime)}` : r.clockedIn ? " · Working" : ""}
                            </p>
                          </div>
                          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${m.chip}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} aria-hidden="true" />
                            {m.label}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : visibleRows.length === 0 ? (
                <div className="p-8"><EmptyState message={q ? "No one matches that search." : "No employees in this view."} /></div>
              ) : (
                <ul className="max-h-[36rem] divide-y divide-slate-100 overflow-y-auto">
                  {visibleRows.map((r) => {
                    const rate = attendanceRate(r);
                    const cells = [
                      { label: "On time", n: r.present, cls: "text-emerald-700" },
                      { label: "Late", n: r.late, cls: "text-amber-700" },
                      { label: "Half", n: r.halfDay, cls: "text-orange-700" },
                      { label: "Absent", n: r.absent, cls: "text-rose-700" },
                      { label: "Leave", n: r.onLeave, cls: "text-sky-700" },
                    ];
                    return (
                      <li key={r.employeeId} className="flex flex-col gap-2.5 px-4 py-3 @xl:flex-row @xl:items-center @xl:gap-4 @xl:px-5">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">{initials(r.name)}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-900">{r.name}</p>
                            {r.code && <p className="font-mono text-[11px] text-slate-400">{r.code}</p>}
                          </div>
                          <span className={`shrink-0 text-sm font-bold tabular-nums @xl:hidden ${rate === null ? "text-slate-300" : rate >= 90 ? "text-emerald-600" : rate >= 75 ? "text-amber-600" : "text-rose-600"}`}>
                            {rate === null ? "—" : `${rate}%`}
                          </span>
                        </div>
                        <div className="grid grid-cols-5 gap-1 @xl:w-64 @xl:shrink-0">
                          {cells.map((c) => (
                            <div key={c.label} className="rounded-lg bg-slate-50 px-1 py-1.5 text-center">
                              <p className={`text-sm font-bold tabular-nums ${c.n > 0 ? c.cls : "text-slate-300"}`}>{c.n}</p>
                              <p className="text-[10px] font-medium text-slate-500">{c.label}</p>
                            </div>
                          ))}
                        </div>
                        <div className="hidden w-24 shrink-0 @xl:block">
                          {rate === null ? (
                            <span className="text-xs text-slate-400">No data yet</span>
                          ) : (
                            <>
                              <p className="text-right text-sm font-bold tabular-nums text-slate-800">{rate}%</p>
                              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                                <span className={`block h-full rounded-full ${rate >= 90 ? "bg-emerald-500" : rate >= 75 ? "bg-amber-400" : "bg-rose-500"}`} style={{ width: `${rate}%` }} />
                              </span>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            </div>

            {/* ---- side: payroll and cycle, workspace shortcuts */}
            <div className="min-w-0 space-y-5">
              {(range !== "cycle" || (isAdmin && data.payroll)) && (
                <Card className="p-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-bold text-slate-900">{range !== "cycle" ? "Salary cycle so far" : "Payroll progress"}</h2>
                      {range !== "cycle" && <p className="text-xs text-slate-500">{data.cycle.label}</p>}
                    </div>
                    {isAdmin ? <Link href="/salary" className="shrink-0 text-xs font-semibold text-indigo-600 hover:underline">Open salary</Link> : null}
                  </div>
                  {range !== "cycle" && (
                    <dl className="grid grid-cols-2 gap-2.5">
                      <CycleStat label="Late marks" value={data.cycle.lateMarks} />
                      <CycleStat label="Half days" value={data.cycle.halfDays} />
                      <CycleStat label="Absent days" value={data.cycle.absentDays} />
                      <CycleStat label="Leave days" value={data.cycle.leaveDays} />
                    </dl>
                  )}
                  {isAdmin && data.payroll && (
                    <div className={range !== "cycle" ? "mt-4 border-t border-slate-100 pt-4" : ""}>
                      {range !== "cycle" && <p className="mb-2 text-xs font-semibold text-slate-500">Payroll progress · {data.payroll.label}</p>}
                      <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
                        {data.payroll.activeEmployees > 0 && (
                          <>
                            <div className="bg-emerald-500" style={{ width: `${((data.payroll.finalized + data.payroll.paid) / data.payroll.activeEmployees) * 100}%` }} />
                            <div className="bg-amber-400" style={{ width: `${(data.payroll.draft / data.payroll.activeEmployees) * 100}%` }} />
                          </>
                        )}
                      </div>
                      <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
                        <div><p className="text-base font-bold tabular-nums text-emerald-700">{data.payroll.finalized + data.payroll.paid}</p><p className="text-[11px] text-slate-500">Finalized</p></div>
                        <div><p className="text-base font-bold tabular-nums text-amber-700">{data.payroll.draft}</p><p className="text-[11px] text-slate-500">Draft</p></div>
                        <div><p className="text-base font-bold tabular-nums text-slate-700">{data.payroll.notCalculated}</p><p className="text-[11px] text-slate-500">Not calculated</p></div>
                      </div>
                    </div>
                  )}
                </Card>
              )}

              {isAdmin && data.setup && (
                <Card className="p-5">
                  <h2 className="mb-3 font-bold text-slate-900">Your workspace</h2>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { href: "/employees", label: "Employees", n: t.totalEmployees },
                      { href: "/departments", label: "Departments", n: data.setup.departments.active },
                      { href: "/locations", label: "Locations", n: data.setup.locations.active },
                      { href: "/managers", label: "Managers", n: data.setup.managers.active },
                    ].map((w) => (
                      <Link key={w.href} href={w.href} className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100 transition hover:bg-white hover:ring-indigo-200">
                        <span className="block text-xl font-bold tabular-nums text-slate-900">{w.n}</span>
                        <span className="block text-xs font-medium text-slate-500">{w.label}</span>
                      </Link>
                    ))}
                  </div>
                  <Link href="/rules" className="mt-2 flex items-center justify-between rounded-xl bg-indigo-50 px-3.5 py-2.5 text-sm font-semibold text-indigo-700 ring-1 ring-indigo-100 hover:bg-indigo-100">
                    <span>Attendance &amp; pay rules</span>
                    <span aria-hidden="true">→</span>
                  </Link>
                </Card>
              )}

              {!isAdmin && data.team && (
                <Card className="p-5">
                  <h2 className="font-bold text-slate-900">Your team</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {data.team.size} employee{data.team.size === 1 ? "" : "s"}
                    {data.team.departments.length ? ` in ${data.team.departments.join(", ")}` : ""}
                    {data.team.locationCount ? ` · ${data.team.locationCount} work location(s)` : ""}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">Your powers are set by your company admin. Anything outside your team is hidden.</p>
                </Card>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CycleStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
      <dt className="text-[11px] font-semibold text-slate-500">{label}</dt>
      <dd className="text-lg font-bold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}
