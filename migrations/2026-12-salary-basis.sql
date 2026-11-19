-- Flexible daily-rate basis: the divisor is 30 (fixed), the working days in the cycle, or the calendar days.
-- The company setting already exists as daily_rate_basis (default "fixed"); this adds the frozen divisor per salary
-- record so finalized months keep the rate they were calculated with. Idempotent.
BEGIN;
ALTER TABLE salary_records ADD COLUMN IF NOT EXISTS daily_rate_divisor numeric(6,2) NOT NULL DEFAULT 30;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS daily_rate_basis varchar(10) NOT NULL DEFAULT 'fixed';
COMMIT;
