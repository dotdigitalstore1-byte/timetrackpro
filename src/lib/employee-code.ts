import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, users } from "@/db/schema";

/** Employee codes look like EMP-0001. Any code an admin types is accepted if it is unused in the company. */
const NUMBERED = /^EMP-(\d+)$/;

/** Trim, upper-case and remove inner spaces, so "emp 0012 " and "EMP-0012" are the same code. */
export function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

type Reader = Pick<typeof db, "select">;

/** The next unused EMP-nnnn code for a company (one above the highest number in use). */
export async function nextEmployeeCode(companyId: string, reader: Reader = db): Promise<string> {
  const rows = await reader.select({ code: employees.employeeCode }).from(employees).where(eq(employees.companyId, companyId));
  let max = 0;
  for (const r of rows) {
    const m = NUMBERED.exec(normaliseCode(r.code ?? ""));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `EMP-${String(max + 1).padStart(4, "0")}`;
}

/** Name of the employee already using this code in the company, if any (case-insensitive). */
export async function codeOwner(
  companyId: string,
  code: string,
  exceptEmployeeId?: string,
  reader: Reader = db
): Promise<string | null> {
  const rows = await reader
    .select({ id: employees.id, fullName: users.fullName })
    .from(employees)
    .innerJoin(users, eq(employees.userId, users.id))
    .where(
      sql`${employees.companyId} = ${companyId} and upper(replace(${employees.employeeCode}, ' ', '')) = ${normaliseCode(code)}`
    );
  const hit = rows.find((r) => r.id !== exceptEmployeeId);
  return hit ? hit.fullName : null;
}
