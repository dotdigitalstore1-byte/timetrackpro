-- Weekly-off work & comp-off, Extra pay toggle, and the fixed 30-day salary base.
-- Run once against the production database (e.g. `psql "$DATABASE_URL" -f migrations/2026-11-comp-off-and-extra-pay.sql`),
-- or let `npm run db:push` apply the matching schema changes. Safe to re-run.

ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS extra_pay_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS extra_pay_rate numeric(4,2) NOT NULL DEFAULT 1;

ALTER TABLE salary_records ADD COLUMN IF NOT EXISTS week_off_worked_days integer NOT NULL DEFAULT 0;
ALTER TABLE salary_records ADD COLUMN IF NOT EXISTS comp_off_used integer NOT NULL DEFAULT 0;
ALTER TABLE salary_records ADD COLUMN IF NOT EXISTS comp_off_unused integer NOT NULL DEFAULT 0;
ALTER TABLE salary_records ADD COLUMN IF NOT EXISTS extra_pay_days integer NOT NULL DEFAULT 0;
ALTER TABLE salary_records ADD COLUMN IF NOT EXISTS extra_pay_amount numeric(12,2) NOT NULL DEFAULT 0;
