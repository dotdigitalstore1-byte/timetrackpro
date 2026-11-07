import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { shiftOf } from "@/lib/company";
import { loadEmployeeOrg } from "@/lib/org";
import { loadAccess, MANAGER_PERMISSIONS } from "@/lib/access";

export async function GET() {
  const ctx = await getAuth();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { user, company, settings, employee } = ctx;
  const [org, access] = await Promise.all([
    employee ? loadEmployeeOrg([employee.id]).then((m) => m.get(employee.id)) : Promise.resolve(undefined),
    loadAccess(ctx),
  ]);
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      phone: user.phone,
    },
    access: {
      isAdmin: access.isAdmin,
      isManager: access.isManager,
      permissions: access.permissions,
      // every key a manager can hold, with labels, for the admin UI
      permissionCatalog: MANAGER_PERMISSIONS,
      departmentIds: access.departmentIds,
      locationIds: access.locationIds,
    },
    company: company
      ? {
          id: company.id,
          name: company.name,
          status: company.status,
          subscriptionPlan: company.subscriptionPlan,
        }
      : null,
    settings: settings
      ? {
          shiftStart: settings.shiftStart,
          shiftEnd: settings.shiftEnd,
          graceMinutes: settings.graceMinutes,
          lateThresholdMinutes: settings.lateThresholdMinutes,
          lateDeductionType: settings.lateDeductionType,
          lateDeductionValue: settings.lateDeductionValue,
          halfDayDeductionType: settings.halfDayDeductionType,
          halfDayDeductionValue: settings.halfDayDeductionValue,
          leaveDeductionType: settings.leaveDeductionType,
          leaveDeductionValue: settings.leaveDeductionValue,
          unapprovedHoldDays: settings.unapprovedHoldDays,
          workDaysPerMonth: settings.workDaysPerMonth,
          currency: settings.currency,
          approvalLevels: settings.approvalLevels,
          timezone: settings.timezone,
        }
      : null,
    employee: employee
      ? {
          id: employee.id,
          employeeCode: employee.employeeCode,
          department: org?.departments.map((d) => d.name).join(", ") || employee.department,
          departments: org?.departments ?? [],
          locations: org?.locations ?? [],
          designation: employee.designation,
          shiftStart: settings ? shiftOf(settings, employee).start : employee.shiftStart,
          shiftEnd: settings ? shiftOf(settings, employee).end : employee.shiftEnd,
          basicSalary: employee.basicSalary,
          managerId: employee.managerId,
        }
      : null,
  });
}