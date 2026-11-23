/**
 * The one place that decides where each role starts. Used by login, the PWA entry point, the dashboard guard,
 * the landing page and the app shell, so no role can be sent to another role's screens.
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

/**
 * Where a signed-in session should land (native = the request comes from the Dotinout mobile app). Only company admins are sent to billing when their company is locked;
 * staff are handled by the app layout (neutral "unavailable" page at the hard cutoff). Sending a locked employee to
 * billing was a routing bug: billing is an admin-only screen.
 */
export function entryPathFor(session: { role: string; locked: boolean; native: boolean }): string {
  if (session.role === "company_admin" && session.locked) return "/billing";
  // Employees use attendance and leave only in the mobile app. On the web they get the download page.
  if (session.role === "employee" && !session.native) return "/get-app";
  return homePathFor(session.role);
}

/** Pages a specialist may open. Anything else is sent back to the specialist queue. */
export function canOpenSpecialistArea(pathname: string): boolean {
  return (
    pathname === "/specialist" ||
    pathname.startsWith("/specialist/") ||
    pathname === "/profile" ||
    pathname.startsWith("/profile/")
  );
}
