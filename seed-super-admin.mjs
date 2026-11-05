// Creates the platform Super Admin directly in the database.
// Usage: npm run seed   (after `npm run db:push`)
import { config } from "dotenv";
import pg from "pg";
import { randomBytes, scryptSync } from "node:crypto";

config({ path: ".env.local" });
config();

const { DATABASE_URL, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD } = process.env;

if (!DATABASE_URL || !SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD) {
  console.error("Missing DATABASE_URL, SUPER_ADMIN_EMAIL or SUPER_ADMIN_PASSWORD in .env / .env.local");
  process.exit(1);
}

// Same format as src/lib/auth.ts hashPassword(): "<salt>:<scrypt hash>"
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const email = SUPER_ADMIN_EMAIL.trim().toLowerCase();
const client = new pg.Client({ connectionString: DATABASE_URL });

try {
  await client.connect();
  const existing = await client.query("select id from users where email = $1", [email]);
  if (existing.rowCount > 0) {
    await client.query(
      "update users set password_hash = $2, full_name = $3, role = 'super_admin', is_active = true where email = $1",
      [email, hashPassword(SUPER_ADMIN_PASSWORD), "Super Admin"]
    );
    console.log(`Super admin updated (password reset from env): ${email}`);
  } else {
    await client.query(
      "insert into users (email, password_hash, full_name, role) values ($1, $2, $3, 'super_admin')",
      [email, hashPassword(SUPER_ADMIN_PASSWORD), "Super Admin"]
    );
    console.log(`Super admin created: ${email}`);
  }
} catch (err) {
  console.error("Seed failed:", err.message);
  if (/relation .* does not exist/i.test(err.message)) {
    console.error("The tables are missing. Run `npm run db:push` first, then try again.");
  }
  process.exitCode = 1;
} finally {
  await client.end();
}
