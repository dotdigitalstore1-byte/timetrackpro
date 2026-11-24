// Response shapes of the existing Dotinout API routes. Money and decimal columns can arrive as strings, so the
// screens convert them with Number() before use.

export interface LoginResponse {
  token: string;
  role: string;
  home?: string;
}

export interface MeResponse {
  user: { id: string; fullName: string; email: string; phone?: string | null; role: string };
  company: { id: string; name: string } | null;
  settings: { shiftStart?: string; shiftEnd?: string; currency?: string; timezone?: string } | null;
  employee: {
    id: string;
    employeeCode?: string | null;
    designation?: string | null;
    department?: string | null;
    locations?: { id: string; name: string }[];
    shiftStart?: string;
    shiftEnd?: string;
    basicSalary?: number | string | null;
  } | null;
}

export interface CycleCounts {
  present: number;
  late: number;
  half: number;
  leave: number;
  absent: number;
}

export interface AttendanceRecord {
  workDate: string;
  punchInTime: string | null;
  punchOutTime: string | null;
  status: string;
  note?: string | null;
  autoHalfDay?: boolean;
}

export interface CalendarDay {
  date: string;
  weekday: string;
  kind: string;
  label: string;
  note: string;
  record: AttendanceRecord | null;
}

export interface AttendanceResponse {
  today: string;
  month: string;
  period: { start: string; end: string };
  summary: CycleCounts;
  days: CalendarDay[] | null;
  records: AttendanceRecord[];
  restricted?: boolean;
}

export interface LeaveBalance {
  year: number;
  quota: number | string;
  used: number | string;
  pending: number | string;
  remaining: number | string;
  mode: string;
}

export interface LeaveRequest {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number | string;
  reason?: string | null;
  status: string;
  rejectionReason?: string | null;
  createdAt?: string;
}

export interface LeavesResponse {
  balance: LeaveBalance | null;
  leaves: LeaveRequest[];
}

export interface CycleOption {
  key: string;
  start: string;
  end: string;
}

export interface SalaryBreakdown {
  basicSalary: number | string;
  attendanceSalary: number | string;
  additionsTotal?: number | string;
  overtimePay?: number | string;
  totalAllDeductions: number | string;
  netPayable: number | string;
  presentDays?: number | string;
  lateDays?: number | string;
  halfDays?: number | string;
  absentDays?: number | string;
  leaveDays?: number | string;
  unapprovedLeaveCount?: number;
}

export interface SalaryHold {
  days: number;
  unapprovedDays: number;
  amount: number | string;
  status: string;
}

export interface SalaryHistoryItem {
  month: number;
  year: number;
  netPayable: number | string;
  status: string;
  disbursementDate: string | null;
}

export interface SalaryResponse {
  employee: { id: string; fullName: string; designation?: string | null } | null;
  year: number;
  month: number;
  period: { start: string; end: string };
  cycles: CycleOption[];
  salaryDate?: string | null;
  disbursementDate?: string | null;
  status: string;
  breakdown: SalaryBreakdown | null;
  holds: SalaryHold[];
  history: SalaryHistoryItem[];
}

export interface NoticeItem {
  id?: string;
  status: string;
  reason?: string | null;
  startDate?: string | null;
  noticeDays?: number | null;
  lastWorkingDay?: string | null;
  daysLeft?: number | null;
  decisionNote?: string | null;
}

export interface NoticeResponse {
  role: string;
  current: NoticeItem | null;
  history: NoticeItem[];
  canRequest?: boolean;
}

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  at: string | null;
  unread: boolean;
  tone: string;
}

export interface NotificationsResponse {
  items: NotificationItem[];
  unreadCount: number;
}

export interface AgreementItem {
  id: string;
  title: string;
  body: string;
  version: number;
  publishedAt?: string | null;
  /** pending | accepted_today | permanent | declined_today */
  status: string;
}

export interface AgreementsResponse {
  todayKey: string;
  agreements: AgreementItem[];
}

export interface SlipRequest {
  id: string;
  year: number;
  month: number;
  /** pending | approved | rejected */
  status: string;
  provisional?: boolean;
  requestedAt?: string | null;
  decidedAt?: string | null;
  rejectionReason?: string | null;
}

export interface SlipsResponse {
  requests: SlipRequest[];
}

export interface SlipDetail {
  company: Record<string, unknown> | null;
  employee: { name: string; code: string | null; designation: string | null };
  provisional: boolean;
  asOf?: string;
  period: { start: string; end: string };
  salaryDate?: string | null;
  disbursementDate?: string | null;
  status: string;
  availableUntil?: string | null;
  breakdown: Record<string, number | string | null>;
}
