import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import PwaRegister from "@/components/PwaRegister";
import NativeSplash from "@/components/NativeSplash";
import NativeBootstrap from "@/components/NativeBootstrap";
import DeviceSecurityGate from "@/components/DeviceSecurityGate";
import RouteProgress from "@/components/RouteProgress";
import { isNativeAppRequest } from "@/lib/app-platform";

export const metadata: Metadata = {
  title: "Dotinout (DIO) — Attendance & Salary Management",
  description:
    "Multi-company attendance, leave and salary management SaaS platform with photo-verified punches, GPS geofencing and payroll automation.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Dotinout",
  },
  applicationName: "Dotinout",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const native = await isNativeAppRequest();
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icons/icon-512.png" sizes="512x512" />
        <link rel="apple-touch-icon" href="/icons/icon-512.png" />
      </head>
      <body className="bg-slate-100 font-sans text-slate-900 antialiased">
        <PwaRegister />
        <NativeBootstrap native={native} />
        <NativeSplash native={native}>
          <RouteProgress />
          {children}
        </NativeSplash>
        <DeviceSecurityGate />
      </body>
    </html>
  );
}