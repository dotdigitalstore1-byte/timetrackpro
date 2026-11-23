import { redirect } from "next/navigation";
import { getAuthAllowLocked } from "@/lib/auth";
import { entryPathFor } from "@/lib/home";
import { isNativeAppRequest } from "@/lib/app-platform";
import SignOutButton from "@/components/SignOutButton";

/** Shown only inside the mobile app to a non-employee account (the app is for employees). */
export default async function AppRestrictedPage() {
  const ctx = await getAuthAllowLocked();
  const native = await isNativeAppRequest();
  if (!native) redirect(ctx ? entryPathFor({ role: ctx.user.role, locked: ctx.locked, native: false }) : "/login");
  if (!ctx) redirect("/login");
  if (ctx.user.role === "employee") redirect("/dashboard");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-100 px-6 pt-[env(safe-area-inset-top)] text-center">
      <div className="max-w-sm rounded-3xl bg-white p-7 shadow-lg">
        <h1 className="text-xl font-extrabold text-slate-900">This app is for employees</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Company admins, managers, specialists and platform owners sign in on the Dotinout website.
        </p>
        <SignOutButton className="mt-6 w-full rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700" />
      </div>
    </div>
  );
}
