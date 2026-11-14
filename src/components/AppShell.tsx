"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { api, clearMe } from "@/lib/client";
import InstallPrompt from "@/components/InstallPrompt";
import CompanyMark from "@/components/CompanyMark";
import NotificationBell from "@/components/NotificationBell";
import AgreementGate from "@/components/AgreementGate";
import AdminFeedbackGate from "@/components/AdminFeedbackGate";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

function Icon({ path }: { path: string }) {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

const icons = {
  home: <Icon path="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10" />,
  attendance: <Icon path="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />,
  leaves: <Icon path="M8 7V3m8 4V3M3 9h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" />,
  salary: <Icon path="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
  reports: <Icon path="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
  employees: <Icon path="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />,
  departments: <Icon path="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />,
  locations: <Icon path="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z" />,
  camera: <Icon path="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9zM15 13a3 3 0 11-6 0 3 3 0 016 0z" />,
  rules: <Icon path="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />,
  settings: <Icon path="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 001.065-2.572zM15 12a3 3 0 11-6 0 3 3 0 016 0z" />,
  building: <Icon path="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5" />,
  user: <Icon path="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />,
  analytics: <Icon path="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
  notice: <Icon path="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
  agreements: <Icon path="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />,
  logout: <Icon path="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />,
};

export default function AppShell({
  role,
  permissions,
  userName,
  userEmail,
  companyName,
  companyPlan,
  logoVersion,
  children,
}: {
  role: string;
  permissions: string[];
  userName: string;
  userEmail: string;
  companyName: string;
  companyPlan: string;
  /** Last-update stamp of the company logo, or null when there is no logo. */
  logoVersion: number | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const isSuperAdmin = role === "super_admin";

  const isAdmin = role === "company_admin";
  const isManager = role === "manager";
  // Managers only see the areas their admin has switched on for them.
  const has = (p: string) => isAdmin || (isManager && permissions.includes(p));

  const mainNav: NavItem[] = isSuperAdmin
    ? [
        { href: "/superadmin", label: "Companies", icon: icons.building },
        { href: "/superadmin/analytics", label: "Analytics", icon: icons.analytics },
      ]
    : [
        { href: "/dashboard", label: "Home", icon: icons.home },
        { href: "/attendance", label: "Attendance", icon: icons.attendance },
        ...(role === "employee" || has("approve_leaves") ? [{ href: "/leaves", label: "Leaves", icon: icons.leaves }] : []),
        ...(role === "employee" || has("view_salary") ? [{ href: "/salary", label: "Salary", icon: icons.salary }] : []),
      ];

  const moreNav: NavItem[] = isSuperAdmin
    ? []
    : [
        ...(isAdmin || isManager ? [{ href: "/employees", label: "Employees", icon: icons.employees }] : []),
        ...(role === "employee" ? [{ href: "/notice", label: "Notice period", icon: icons.notice }] : []),
        ...(isAdmin ? [{ href: "/managers", label: "Managers", icon: icons.employees }] : []),
        ...(has("view_reports") ? [{ href: "/reports", label: "Reports", icon: icons.reports }] : []),
        ...(has("view_photos") ? [{ href: "/photo-audit", label: "Photo audit", icon: icons.camera }] : []),
        ...(isAdmin
          ? [
              { href: "/departments", label: "Departments", icon: icons.departments },
              { href: "/locations", label: "Locations", icon: icons.locations },
              { href: "/rules", label: "Rules", icon: icons.rules },
              { href: "/agreements", label: "Agreements", icon: icons.agreements },
              { href: "/notice", label: "Notice period", icon: icons.notice },
              { href: "/settings", label: "Settings", icon: icons.settings },
            ]
          : []),
        { href: "/profile", label: "Profile", icon: icons.user },
      ];

  const desktopNav = [...mainNav, ...moreNav];
  const bottomNav = mainNav.slice(0, 4);
  const hasMoreSheet = moreNav.length > 0;
  const initials = (userName || userEmail)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  const showBell = !isSuperAdmin;
  const defaultMarkDesktop = (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </div>
  );
  const defaultMarkMobile = (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </div>
  );

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    clearMe();
    router.push("/login");
    router.refresh();
  };

  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="min-h-dvh bg-slate-100">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-5">
          {isSuperAdmin ? (
            defaultMarkDesktop
          ) : (
            <CompanyMark
              version={logoVersion}
              className="h-9 w-9 shrink-0 rounded-xl object-contain"
              fallback={defaultMarkDesktop}
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-tight text-slate-900">
              {isSuperAdmin ? "TimeTrack Platform" : companyName}
            </p>
            <p className="text-[10px] font-medium uppercase tracking-wide text-indigo-500">
              {isSuperAdmin ? "Platform admin" : companyPlan ? `${companyPlan} plan` : "Workspace"}
            </p>
          </div>
          {showBell && <NotificationBell />}
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {desktopNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active(item.href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors",
                active(item.href) ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50"
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-4">
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50"
          >
            {icons.logout}
            {loggingOut ? "Logging out..." : "Logout"}
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          {isSuperAdmin ? (
            defaultMarkMobile
          ) : (
            <CompanyMark version={logoVersion} className="h-8 w-8 shrink-0 rounded-lg object-contain" fallback={defaultMarkMobile} />
          )}
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-bold text-slate-900">{isSuperAdmin ? "TimeTrack Platform" : companyName}</p>
            <p className="truncate text-[10px] font-medium text-slate-400">{userName}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {showBell && <NotificationBell />}
          <Link
            href="/profile"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-700"
            aria-label="Profile"
          >
            {initials || "U"}
          </Link>
          <button onClick={handleLogout} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" aria-label="Logout">
            {icons.logout}
          </button>
        </div>
      </header>

      {/* Mobile bottom nav */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="flex items-stretch justify-around">
          {bottomNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active(item.href) ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold",
                active(item.href) ? "text-indigo-600" : "text-slate-400"
              )}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
          {hasMoreSheet && (
            <button
              onClick={() => setMoreOpen(true)}
              className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold text-slate-400"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              More
            </button>
          )}
        </div>
      </div>

      {/* More sheet */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300" />
            <p className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-slate-400">More</p>
            <div className="space-y-1">
              {moreNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {item.icon}
                  {item.label}
                </Link>
              ))}
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold text-rose-600 hover:bg-rose-50"
              >
                {icons.logout}
                Logout
              </button>
            </div>
          </div>
        </div>
      )}

      <InstallPrompt />

      {role === "employee" && <AgreementGate />}
      {role === "company_admin" && <AdminFeedbackGate />}

      {/* Main content */}
      <main className="mx-auto w-full max-w-5xl px-4 py-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:px-8 lg:pb-10 lg:pl-72">
        {children}
      </main>
    </div>
  );
}