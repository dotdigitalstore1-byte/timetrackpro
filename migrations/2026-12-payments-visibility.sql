-- Payments visibility for the platform owner: payment method, refunded amount and gateway metadata per payment.
-- Idempotent. Run once per existing database:
--   psql "$DATABASE_URL" -f migrations/2026-12-payments-visibility.sql
-- Payments made before this migration keep a NULL method and empty metadata. Their status, amount and dates are unchanged.

BEGIN;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method varchar(30);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_amount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS payments_created_idx ON payments (created_at);
CREATE INDEX IF NOT EXISTS payments_paid_idx ON payments (paid_at);

COMMIT;
