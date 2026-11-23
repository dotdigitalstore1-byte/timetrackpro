import { NextResponse } from "next/server";
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
