import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendance, employees } from "@/db/schema";
import { getAuth } from "@/lib/auth";

// Photos are private: only the employee, their manager and company admins of the SAME company may view them.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuth();
  if (!ctx || ctx.user.role === "super_admin" || !ctx.company) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const which = new URL(req.url).searchParams.get("which") === "out" ? "out" : "in";

  const rows = await db
    .select({ rec: attendance, emp: employees })
    .from(attendance)
    .innerJoin(employees, eq(attendance.employeeId, employees.id))
    .where(and(eq(attendance.id, id), eq(attendance.companyId, ctx.company.id)))
    .limit(1);
  const row = rows[0];
  if (!row) return new Response("Not found", { status: 404 });

  const role = ctx.user.role;
  const allowed =
    role === "company_admin" ||
    (role === "manager" && (row.emp.managerId === ctx.employee?.id || row.emp.id === ctx.employee?.id)) ||
    row.emp.id === ctx.employee?.id;
  if (!allowed) return new Response("Forbidden", { status: 403 });

  const data = which === "out" ? row.rec.punchOutPhoto : row.rec.punchInPhoto;
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
