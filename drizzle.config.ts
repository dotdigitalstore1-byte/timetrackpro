import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load .env.local first (the same file Next.js prefers), then fall back to .env
config({ path: ".env.local" });
config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in .env.local or .env");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL },
});
