import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getAuth } from "@/lib/auth";
import { loadAccess } from "@/lib/access";
import { loadLogoVersion } from "@/lib/company-profile";
import AppShell from "@/components/AppShell";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await getAuth();
  if (!ctx) {
    redirect("/login");
  }

  // Navigation follows the same powers the API enforces, so people only see what they can use.
  const access = await loadAccess(ctx);
  const logoVersion = ctx.company ? await loadLogoVersion(ctx.company.id) : null;

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
      {children}
    </AppShell>
  );
}