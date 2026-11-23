import { NextResponse, type NextRequest } from "next/server";
import { isNativeAppUserAgent, NATIVE_APP_COOKIE, readCookie } from "@/lib/app-platform-core";

/**
 * Remembers the mobile app on the device. The first request from the app carries the user-agent token, and this
 * sets a long-lived cookie. Later cold starts and background requests then identify the app even if the
 * user-agent is missing, so the web screens are never shown inside the app.
 */
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const fromApp = isNativeAppUserAgent(req.headers.get("user-agent"));
  if (fromApp && readCookie(req.headers.get("cookie"), NATIVE_APP_COOKIE) !== "1") {
    res.cookies.set(NATIVE_APP_COOKIE, "1", {
      path: "/",
      maxAge: 400 * 24 * 60 * 60,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return res;
}

export const config = {
  // Skip static files and the service worker; everything else needs the platform check.
  matcher: ["/((?!_next/static|_next/image|icons/|sw\\.js|manifest\\.webmanifest|favicon\\.ico).*)"],
};
