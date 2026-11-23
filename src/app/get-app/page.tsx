import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthAllowLocked } from "@/lib/auth";
import { entryPathFor } from "@/lib/home";
import { isNativeAppRequest } from "@/lib/app-platform";
import { loadAppLinks } from "@/lib/app-downloads";
import AppDownloadView from "@/components/AppDownloadView";

export const metadata: Metadata = { title: "Get the Dotinout app" };

/**
 * Shown to employees who sign in on the web. Attendance, leave and salary are used only in the mobile app,
 * so this page offers the store links and direct downloads the Super Admin has set up.
 */
export default async function GetAppPage() {
  const ctx = await getAuthAllowLocked();
  if (!ctx) redirect("/login");
  const native = await isNativeAppRequest();
  // Only web employees belong here. The mobile app, admins, managers and the platform owner go to their own home.
  if (ctx.user.role !== "employee" || native) {
    redirect(entryPathFor({ role: ctx.user.role, locked: ctx.locked, native }));
  }
  if (ctx.staffLocked) redirect("/unavailable");

  const links = await loadAppLinks();
  return (
    <AppDownloadView
      employeeName={ctx.user.fullName}
      playStoreUrl={links.playStoreUrl}
      appStoreUrl={links.appStoreUrl}
      androidFile={links.files.android}
      iosFile={links.files.ios}
    />
  );
}
