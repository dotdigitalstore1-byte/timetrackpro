import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getAuthAllowLocked } from "@/lib/auth";
import { isNativeAppRequest } from "@/lib/app-platform";
import { loadGracePolicy } from "@/lib/grace-policy";
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
  // The mobile app is for employees only; employees on the web get the download page.
  const native = await isNativeAppRequest();
  if (native && ctx.user.role !== "employee") redirect("/app-restricted");
  if (!native && ctx.user.role === "employee") redirect("/get-app");

  const access = await loadAccess(ctx);
  const logoVersion = ctx.company ? await loadLogoVersion(ctx.company.id) : null;

  const info = ctx.company ? accessInfo(ctx.company, new Date(), await loadGracePolicy()) : null;
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
