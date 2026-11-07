import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendance } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { can, canSeeEmployee, loadAccess } from "@/lib/access";

// Photos are private: the employee, admins, and managers with the view_photos power for their own team.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuth();
  if (!ctx || ctx.user.role === "super_admin" || !ctx.company) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const which = new URL(req.url).searchParams.get("which") === "out" ? "out" : "in";

  const access = await loadAccess(ctx);
  if (!can(access, "view_photos") && !access.isEmployee) return new Response("Forbidden", { status: 403 });

  const row = (
    await db
      .select({ rec: attendance })
      .from(attendance)
      .where(and(eq(attendance.id, id), eq(attendance.companyId, ctx.company.id)))
      .limit(1)
  )[0]?.rec;
  if (!row) return new Response("Not found", { status: 404 });
  if (!(await canSeeEmployee(ctx, access, row.employeeId))) return new Response("Forbidden", { status: 403 });

  const data = which === "out" ? row.punchOutPhoto : row.punchInPhoto;
  const m = data?.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) return new Response("No photo", { status: 404 });

  return new Response(Buffer.from(m[2], "base64"), {
    headers: {
      "Content-Type": m[1],
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
