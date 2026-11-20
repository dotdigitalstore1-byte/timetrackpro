/**
 * The one place that decides where each role starts. Used by login, the PWA entry point, the dashboard guard,
 * and the app shell, so no role can be sent to another role's screens.
 */
export function homePathFor(role: string): string {
  switch (role) {
    case "super_admin":
      return "/superadmin";
    case "onboarding_specialist":
      return "/specialist";
    default:
      // company_admin, manager and employee start on the attendance dashboard (Punch In / Punch Out for staff).
      return "/dashboard";
  }
}

/** Pages a role may open. Anything else is sent back to that role's home page. */
export function canOpenSpecialistArea(pathname: string): boolean {
  return pathname === "/specialist" || pathname.startsWith("/specialist/") || pathname === "/profile" || pathname.startsWith("/profile/");
}
