import { apiRequest } from './client';
import type {
  AgreementsResponse,
  AttendanceResponse,
  LeavesResponse,
  LoginResponse,
  MeResponse,
  NoticeResponse,
  NotificationsResponse,
  SalaryResponse,
  SlipDetail,
  SlipsResponse,
} from './types';

/** Employee sign-in. Returns a bearer token, which the app keeps in secure device storage. */
export const login = (identifier: string, password: string) =>
  apiRequest<LoginResponse>('/api/mobile/auth/login', { method: 'POST', body: { identifier, password }, auth: false });

export const me = () => apiRequest<MeResponse>('/api/auth/me');

export const logout = () => apiRequest<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });

/** month is a salary-cycle key such as "2026-11". Without it the server returns the current cycle. */
export const attendance = (month?: string) =>
  apiRequest<AttendanceResponse>(`/api/attendance${month ? `?month=${encodeURIComponent(month)}` : ''}`);

export const leaves = () => apiRequest<LeavesResponse>('/api/leaves');

/** The key makes a retry safe: the server returns the first result instead of creating the leave twice. */
export const createLeave = (
  body: { startDate: string; endDate: string; leaveType: 'casual' | 'medical'; reason: string },
  idempotencyKey: string
) =>
  apiRequest<{ ok: boolean; id: string; days: number }>('/api/leaves', {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });

export const cancelLeave = (id: string) =>
  apiRequest<{ ok: boolean }>(`/api/leaves/${encodeURIComponent(id)}`, { method: 'PATCH', body: { action: 'cancel' } });

export const salary = (month?: string) =>
  apiRequest<SalaryResponse>(`/api/salary${month ? `?month=${encodeURIComponent(month)}` : ''}`);

export const notice = () => apiRequest<NoticeResponse>('/api/notice');

/** The signature must be the employee's full name exactly as on the account. The server checks it too. */
export const requestNotice = (body: { signature: string; reason?: string }) =>
  apiRequest<{ ok: boolean; id?: string }>('/api/notice', {
    method: 'POST',
    body: { action: 'request', confirmed: true, ...body },
  });

export const withdrawNotice = (noticeId: string) =>
  apiRequest<{ ok: boolean }>('/api/notice', { method: 'POST', body: { action: 'withdraw', noticeId } });

export const notifications = () => apiRequest<NotificationsResponse>('/api/notifications');

export const agreements = () => apiRequest<AgreementsResponse>('/api/agreements');

export const respondToAgreement = (agreementId: string, response: 'accepted' | 'declined', dontShowAgain: boolean) =>
  apiRequest<{ ok: boolean; status: string }>('/api/agreements/respond', {
    method: 'POST',
    body: { agreementId, response, dontShowAgain },
  });

export const salarySlips = () => apiRequest<SlipsResponse>('/api/salary/slips');

export const requestSalarySlip = (month: string) =>
  apiRequest<{ ok: boolean; status: string }>('/api/salary/slips', { method: 'POST', body: { action: 'request', month } });

export const salarySlip = (id: string) => apiRequest<SlipDetail>(`/api/salary/slips/${encodeURIComponent(id)}`);

/** Signed, session-bound challenge that the next punch must include. Fetched right before each punch. */
export const punchChallenge = () => apiRequest<{ ts: number; sig: string }>('/api/attendance/challenge');

export interface PunchBody {
  type: 'in' | 'out';
  photo: string;
  lat: number;
  lng: number;
  accuracy?: number;
  fixAgeMs: number;
  mockLocation: boolean;
  developerOptions: boolean;
  challenge: { ts: number; sig: string };
}

/** The server takes the time itself and ignores any client clock. A repeated punch returns duplicate: true. */
export const punch = (body: PunchBody) =>
  apiRequest<{ ok?: boolean; duplicate?: boolean; status?: string }>('/api/attendance', { method: 'POST', body });
