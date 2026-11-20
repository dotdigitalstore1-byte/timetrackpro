import { redirect } from "next/navigation";
import { getAuthAllowLocked } from "@/lib/auth";
import { homePathFor } from "@/lib/home";
import DashboardView from "@/components/DashboardView";

/**
 * Server-side guard: only roles whose home is the attendance dashboard may render it. Expert Specialists are sent to
 * their queue before any attendance request is made, so they never see the punch screen or its errors.
 */
export default async function DashboardPage() {
  const ctx = await getAuthAllowLocked();
  if (ctx) {
    const home = homePathFor(ctx.user.role);
    if (home !== "/dashboard") redirect(home);
  }
  return <DashboardView />;
}
