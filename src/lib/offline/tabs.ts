"use client";

import { api } from "@/lib/client";
import { prefetchResource } from "@/lib/offline/resource";

/**
 * Cache keys and request URLs for the employee tab screens. The screens and the launch prefetch both use these,
 * so they always share one copy per user.
 */
export const resourceKeys = {
  dashboard: (userId: string) => `${userId}:dashboard`,
  leaves: (userId: string) => `${userId}:leaves`,
  attendance: (userId: string, month: string, employeeId: string) => `${userId}:attendance:${month}:${employeeId}`,
  salary: (userId: string, month: string, employeeId: string) => `${userId}:salary:${month}:${employeeId}`,
};

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) if (value) qs.set(name, value);
  const text = qs.toString();
  return text ? `${path}?${text}` : path;
}

export const resourceUrls = {
  leaves: () => "/api/leaves",
  attendance: (month: string, employeeId: string) => withQuery("/api/attendance", { month, employeeId }),
  salary: (month: string, employeeId: string) => withQuery("/api/salary", { month, employeeId }),
};

/**
 * Warms the employee's three tabs (Attendance, Leaves, Salary) for the current cycle, so switching tabs is instant.
 * Only for employees: managers and admins see wider data that is not worth fetching on every launch.
 */
export function prefetchEmployeeTabs(userId: string): void {
  void prefetchResource(resourceKeys.leaves(userId), () => api(resourceUrls.leaves()));
  void prefetchResource(resourceKeys.attendance(userId, "", ""), () => api(resourceUrls.attendance("", "")));
  void prefetchResource(resourceKeys.salary(userId, "", ""), () => api(resourceUrls.salary("", "")));
}
