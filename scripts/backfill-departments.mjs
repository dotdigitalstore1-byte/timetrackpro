// One-off migration: turns the old free-text `employees.department` values into real departments
// and links each employee to theirs. Safe to run more than once. Run AFTER `npm run db:push`.
//
//   npm run db:backfill
//
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
config();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set in .env.local or .env");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: url,
  ssl: /supabase\.(co|com)|neon\.tech|sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
});

try {
  await client.connect();
  await client.query("BEGIN");

  const created = await client.query(`
    INSERT INTO departments (company_id, name)
    SELECT DISTINCT ON (e.company_id, lower(btrim(e.department))) e.company_id, btrim(e.department)
    FROM employees e
    WHERE btrim(coalesce(e.department, '')) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM departments d
        WHERE d.company_id = e.company_id AND lower(d.name) = lower(btrim(e.department))
      )
    ORDER BY e.company_id, lower(btrim(e.department))
  `);

  const linked = await client.query(`
    INSERT INTO employee_departments (employee_id, department_id)
    SELECT e.id, d.id
    FROM employees e
    JOIN departments d ON d.company_id = e.company_id AND lower(d.name) = lower(btrim(e.department))
    WHERE btrim(coalesce(e.department, '')) <> ''
    ON CONFLICT DO NOTHING
  `);

  await client.query("COMMIT");
  console.log(`Departments created: ${created.rowCount}`);
  console.log(`Employee links created: ${linked.rowCount}`);
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Backfill failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
