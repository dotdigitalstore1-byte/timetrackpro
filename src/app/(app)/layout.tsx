import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getAuthAllowLocked } from "@/lib/auth";
import { loadAccess } from "@/lib/access";
import { loadLogoVersion } from "@/lib/company-profile";
import { accessInfo } from "@/lib/billing-core";
import AppShell from "@/components/AppShell";
import TrialBanner from "@/components/TrialBanner";
import ClientGates from "@/components/ClientGates";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await getAuthAllowLocked();
  if (!ctx) {
    redirect("/login");
  }
  // Admins are sent to billing as soon as the period ends. Staff keep working through the grace window and only see a
  // neutral page at the 30-day hard cutoff (never a message about the plan).
  if (ctx.user.role === "company_admin" && ctx.locked) {
    redirect("/billing");
  }
  if (ctx.user.role !== "company_admin" && ctx.staffLocked) {
    redirect("/unavailable");
  }

  const access = await loadAccess(ctx);
  const logoVersion = ctx.company ? await loadLogoVersion(ctx.company.id) : null;

  const info = ctx.company ? accessInfo(ctx.company, new Date()) : null;
  const showTrial = info?.state === "trial" && ctx.user.role === "company_admin";

  return (
    <AppShell
      role={ctx.user.role}
      permissions={access.permissions}
      userName={ctx.user.fullName}
      userEmail={ctx.user.email}
      companyName={ctx.company?.name ?? "Platform"}
      companyPlan={ctx.company?.subscriptionPlan ?? ""}
      logoVersion={logoVersion}
    >
      <ClientGates restricted={ctx.restricted} forcePasswordChange={ctx.user.mustChangePassword}>
        {showTrial && info && <TrialBanner daysLeft={info.daysLeft ?? 0} employeeLimit={info.employeeLimit} />}
        {children}
      </ClientGates>
    </AppShell>
  );
}
