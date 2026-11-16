-- Payments (Razorpay / Cashfree), forgot-password codes, forced password change.
-- Idempotent. Run once per existing database: psql "$DATABASE_URL" -f migrations/2026-12-payments-reset-and-grace.sql
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES plans(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  provider varchar(20) NOT NULL,
  provider_order_id varchar(120),
  provider_payment_id varchar(120),
  months integer NOT NULL,
  amount numeric(12,2) NOT NULL,
  discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  currency varchar(3) NOT NULL DEFAULT 'INR',
  status varchar(20) NOT NULL DEFAULT 'created',
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_order_uq ON payments (provider, provider_order_id);

CREATE TABLE IF NOT EXISTS password_resets (
  email varchar(200) PRIMARY KEY,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  last_sent_at timestamptz NOT NULL,
  reset_token_hash text,
  reset_token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
