import { NextResponse } from "next/server";
import { isNativeRequestHeaders } from "@/lib/app-platform-core";
import type { AuthContext } from "@/lib/auth";

/**
 * Role gate for API routes. Use after getAuth(): it returns a 403 response when the signed-in role is not allowed,
 * or null when the request may continue. Routes must always check the role on the server, never rely on the UI.
 */
export function requireRoles(ctx: AuthContext, roles: readonly string[]): NextResponse | null {
  if (!roles.includes(ctx.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/**
 * Employee self-service actions (punch, leave, salary, notices) are allowed only from the mobile app.
 * Call after getAuth(). Admins, managers and the platform owner are not affected.
 */
export function requireEmployeeApp(ctx: AuthContext, req: Request): NextResponse | null {
  if (ctx.user.role !== "employee") return null;
  // Bearer tokens are issued only by the mobile sign-in, which accepts employees only.
  if (ctx.viaBearer) return null;
  if (isNativeRequestHeaders(req.headers.get("user-agent"), req.headers.get("cookie"))) return null;
  return NextResponse.json(
    { error: "This is only available in the Dotinout mobile app. Download it from the app page." },
    { status: 403 }
  );
}
