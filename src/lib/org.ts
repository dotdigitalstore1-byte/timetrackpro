import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { departments, employeeDepartments, employeeLocations, geofences } from "@/db/schema";
import { isUuid } from "@/lib/ids";

export { parseIdList } from "@/lib/ids";

export interface OrgRef {
  id: string;
  name: string;
}

export interface EmployeeOrg {
  departments: OrgRef[];
  locations: OrgRef[];
}

/**
 * Checks that every id exists and belongs to this company.
 * Returns an error message or null. Prevents assigning another tenant's departments/locations.
 */
export async function validateOrgIds(
  companyId: string,
  departmentIds: string[],
  locationIds: string[]
): Promise<string | null> {
  if (departmentIds.some((id) => !isUuid(id)) || locationIds.some((id) => !isUuid(id))) {
    return "Invalid department or location selected.";
  }
  if (departmentIds.length) {
    const rows = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.companyId, companyId), inArray(departments.id, departmentIds)));
    if (rows.length !== departmentIds.length) return "One or more selected departments were not found.";
  }
  if (locationIds.length) {
    const rows = await db
      .select({ id: geofences.id })
      .from(geofences)
      .where(and(eq(geofences.companyId, companyId), inArray(geofences.id, locationIds)));
    if (rows.length !== locationIds.length) return "One or more selected locations were not found.";
  }
  return null;
}

/** Departments and locations for a set of employees, keyed by employee id. */
export async function loadEmployeeOrg(employeeIds: string[]): Promise<Map<string, EmployeeOrg>> {
  const result = new Map<string, EmployeeOrg>();
  for (const id of employeeIds) result.set(id, { departments: [], locations: [] });
  if (employeeIds.length === 0) return result;

  const [deptRows, locRows] = await Promise.all([
    db
      .select({ employeeId: employeeDepartments.employeeId, id: departments.id, name: departments.name })
      .from(employeeDepartments)
      .innerJoin(departments, eq(employeeDepartments.departmentId, departments.id))
      .where(inArray(employeeDepartments.employeeId, employeeIds)),
    db
      .select({ employeeId: employeeLocations.employeeId, id: geofences.id, name: geofences.name })
      .from(employeeLocations)
      .innerJoin(geofences, eq(employeeLocations.locationId, geofences.id))
      .where(inArray(employeeLocations.employeeId, employeeIds)),
  ]);

  for (const r of deptRows) result.get(r.employeeId)?.departments.push({ id: r.id, name: r.name });
  for (const r of locRows) result.get(r.employeeId)?.locations.push({ id: r.id, name: r.name });
  for (const org of result.values()) {
    org.departments.sort((a, b) => a.name.localeCompare(b.name));
    org.locations.sort((a, b) => a.name.localeCompare(b.name));
  }
  return result;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Replaces an employee's department and/or location assignments. `undefined` leaves a set untouched. */
export async function replaceEmployeeOrg(
  tx: Tx,
  employeeId: string,
  departmentIds: string[] | undefined,
  locationIds: string[] | undefined
): Promise<void> {
  if (departmentIds) {
    await tx.delete(employeeDepartments).where(eq(employeeDepartments.employeeId, employeeId));
    if (departmentIds.length) {
      await tx.insert(employeeDepartments).values(departmentIds.map((departmentId) => ({ employeeId, departmentId })));
    }
  }
  if (locationIds) {
    await tx.delete(employeeLocations).where(eq(employeeLocations.employeeId, employeeId));
    if (locationIds.length) {
      await tx.insert(employeeLocations).values(locationIds.map((locationId) => ({ employeeId, locationId })));
    }
  }
}
