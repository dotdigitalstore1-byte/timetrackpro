import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import PwaRegister from "@/components/PwaRegister";

export const metadata: Metadata = {
  title: "TimeTrack Pro — Attendance & Salary Management",
  description:
    "Multi-company attendance, leave and salary management SaaS platform with photo-verified punches, GPS geofencing and payroll automation.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TimeTrack",
  },
  applicationName: "TimeTrack Pro",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icons/icon-512.png" sizes="512x512" />
        <link rel="apple-touch-icon" href="/icons/icon-512.png" />
      </head>
      <body className="bg-slate-100 font-sans text-slate-900 antialiased">
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}