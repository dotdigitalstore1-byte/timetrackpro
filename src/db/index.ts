import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

function createPool(url: string): Pool {
  const p = new Pool({
    connectionString: url,
    // Hosted Postgres (Supabase, Neon, RDS...) requires TLS; local Postgres usually does not.
    ssl: /supabase\.(co|com)|neon\.tech|sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // A stuck query must not hold a pooled connection (and a serverless instance) for minutes during a spike.
    statement_timeout: 20_000,
    query_timeout: 25_000,
  });
  // A dropped idle connection must not crash the server process.
  p.on("error", (err) => {
    console.error("Unexpected Postgres pool error", err);
  });
  return p;
}

export const pool = globalForDb.__arenaNextJsPostgresqlPool ?? createPool(databaseUrl);

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
