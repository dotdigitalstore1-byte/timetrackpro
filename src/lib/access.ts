import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  employeeDepartments,
  employeeLocations,
  employees,
  managerDepartments,
  managerLocations,
  users,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth";

/** Powers an admin can grant a manager. Every key is enforced on the server. */
export const MANAGER_PERMISSIONS = [
  {
    key: "approve_leaves",
    label: "Approve or reject leave",
    description: "Decide leave requests from their team. With two approval levels this is Level 1; the admin gives the final approval.",
  },
  {
    key: "manage_attendance",
    label: "Edit and remove attendance",
    description: "Correct punch times and status, and remove attendance records for their team. Every change is logged.",
  },
  {
    key: "manage_employees",
    label: "Add and edit team members",
    description: "Add employees and update their details, limited to their own departments and locations. Salary can only be set by an admin.",
  },
  {
    key: "view_photos",
    label: "View punch photos",
    description: "Use Photo audit to check punch photos for their team.",
  },
  {
    key: "view_reports",
    label: "View and export reports",
    description: "Attendance and leave reports for their team.",
  },
  {
    key: "view_salary",
    label: "View team salary (read only)",
    description: "See salary breakdowns for their team. Only admins can calculate, finalise or pay salaries.",
  },
] as const;

export type ManagerPermission = (typeof MANAGER_PERMISSIONS)[number]["key"];
const PERMISSION_KEYS = new Set<string>(MANAGER_PERMISSIONS.map((p) => p.key));

export function validPermissions(input: unknown): ManagerPermission[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map(String))].filter((k) => PERMISSION_KEYS.has(k)) as ManagerPermission[];
}

export interface Access {
  isAdmin: boolean;
  isManager: boolean;
  isEmployee: boolean;
  permissions: ManagerPermission[];
  departmentIds: string[];
  locationIds: string[];
}

/** Who the viewer is and what they may do. Loads a manager's scope; other roles need no extra queries. */
export async function loadAccess(ctx: AuthContext): Promise<Access> {
  const role = ctx.user.role;
  const access: Access = {
    isAdmin: role === "company_admin",
    isManager: role === "manager",
    isEmployee: role === "employee",
    permissions: [],
    departmentIds: [],
    locationIds: [],
  };
  if (!access.isManager) return access;

  const [deps, locs] = await Promise.all([
    db.select({ id: managerDepartments.departmentId }).from(managerDepartments).where(eq(managerDepartments.userId, ctx.user.id)),
    db.select({ id: managerLocations.locationId }).from(managerLocations).where(eq(managerLocations.userId, ctx.user.id)),
  ]);
  access.permissions = validPermissions(ctx.user.managerPermissions);
  access.departmentIds = deps.map((d) => d.id);
  access.locationIds = locs.map((l) => l.id);
  return access;
}

/** Does the viewer hold this power? Admins hold all of them. */
export function can(access: Access, permission: ManagerPermission): boolean {
  return access.isAdmin || (access.isManager && access.permissions.includes(permission));
}

/**
 * Employee accounts this viewer may see.
 *  - Admin: every employee account in the company (admins and managers are not counted as employees).
 *  - Manager: employees in one of the manager's departments. If the manager has locations, only employees who
 *    have no location assigned or who work at one of the manager's locations.
 *  - Employee: only themselves.
 */
export async function visibleEmployeeIds(ctx: AuthContext, access: Access): Promise<Set<string>> {
  return scopeEmployeeIds(ctx.company!.id, access, ctx.employee?.id ?? null);
}

/** The same scope for any access object (used to show each manager's team size on the Managers page). */
export async function scopeEmployeeIds(
  companyId: string,
  access: Access,
  selfEmployeeId: string | null
): Promise<Set<string>> {
  if (access.isEmployee) return new Set(selfEmployeeId ? [selfEmployeeId] : []);

  const all = await db
    .select({ id: employees.id, role: users.role })
    .from(employees)
    .innerJoin(users, eq(employees.userId, users.id))
    .where(eq(employees.companyId, companyId));
  const employeeAccounts = all.filter((e) => e.role === "employee").map((e) => e.id);

  if (access.isAdmin) return new Set(employeeAccounts);
  if (!access.isManager || access.departmentIds.length === 0) return new Set();

  const inDepartments = await db
    .select({ employeeId: employeeDepartments.employeeId })
    .from(employeeDepartments)
    .where(inArray(employeeDepartments.departmentId, access.departmentIds));
  const departmentMembers = new Set(inDepartments.map((r) => r.employeeId));
  let allowed = new Set(employeeAccounts.filter((id) => departmentMembers.has(id)));

  if (access.locationIds.length > 0 && allowed.size > 0) {
    const locationRows = await db
      .select({ employeeId: employeeLocations.employeeId, locationId: employeeLocations.locationId })
      .from(employeeLocations)
      .innerJoin(employees, eq(employeeLocations.employeeId, employees.id))
      .where(eq(employees.companyId, companyId));
    const hasAnyLocation = new Set(locationRows.map((r) => r.employeeId));
    const atMyLocation = new Set(
      locationRows.filter((r) => access.locationIds.includes(r.locationId)).map((r) => r.employeeId)
    );
    allowed = new Set([...allowed].filter((id) => !hasAnyLocation.has(id) || atMyLocation.has(id)));
  }
  return allowed;
}

/** Single-person check used for per-record endpoints (cheaper than loading the whole visible set). */
export async function canSeeEmployee(ctx: AuthContext, access: Access, employeeId: string): Promise<boolean> {
  if (access.isAdmin) return true; // the record is already scoped to this company
  if (access.isEmployee) return ctx.employee?.id === employeeId;
  return (await visibleEmployeeIds(ctx, access)).has(employeeId);
}
