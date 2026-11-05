import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getAuth } from "@/lib/auth";
import AppShell from "@/components/AppShell";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await getAuth();
  if (!ctx) {
    redirect("/login");
  }

  return (
    <AppShell
      role={ctx.user.role}
      userName={ctx.user.fullName}
      userEmail={ctx.user.email}
      companyName={ctx.company?.name ?? "Platform"}
      companyPlan={ctx.company?.subscriptionPlan ?? ""}
    >
      {children}
    </AppShell>
  );
}