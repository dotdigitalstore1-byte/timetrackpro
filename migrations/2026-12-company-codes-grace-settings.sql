-- Unique company codes, platform-wide grace periods, and payment refund statuses.
-- Idempotent. Run once per existing database:
--   psql "$DATABASE_URL" -f migrations/2026-12-company-codes-grace-settings.sql

BEGIN;

-- 1. Unique company code (e.g. CO-7K3D-9PMQ). Existing companies get one derived from their id.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS code varchar(20);

UPDATE companies
SET code = 'CO-' || substr(upper(md5(id::text)), 1, 4) || '-' || substr(upper(md5(id::text)), 5, 4)
WHERE code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS companies_code_uq ON companies (code);

-- 2. Platform grace periods (single row). Defaults: hide history from day 5, stop punching on day 20, full block on day 30.
CREATE TABLE IF NOT EXISTS platform_settings (
  id integer PRIMARY KEY DEFAULT 1,
  grace_blur_after_days integer NOT NULL DEFAULT 5,
  grace_punch_until_days integer NOT NULL DEFAULT 20,
  grace_block_after_days integer NOT NULL DEFAULT 30,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT platform_settings_single_row CHECK (id = 1),
  CONSTRAINT platform_settings_order CHECK (
    grace_blur_after_days >= 0
    AND grace_blur_after_days <= grace_punch_until_days
    AND grace_punch_until_days <= grace_block_after_days
    AND grace_block_after_days <= 365
  )
);

INSERT INTO platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 3. Payments: refunds now have their own statuses (no column change needed; status is a free varchar(20)).
COMMENT ON COLUMN payments.status IS 'created | processing | paid | failed | refunded | partially_refunded';

COMMIT;
