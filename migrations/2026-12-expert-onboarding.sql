-- Expert Onboarding (paid setup service). Idempotent. Run once per existing database:
--   psql "$DATABASE_URL" -f migrations/2026-12-expert-onboarding.sql
-- The base fee starts at 0, which keeps checkout closed until the platform owner sets it.
-- Adds the pricing settings, employee slabs, specialist profiles, paid requests and their audit trail.
-- The new user role `onboarding_specialist` (21 chars) needs users.role widened to varchar(50); see 2026-12-users-role-length.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS onboarding_settings (
  id integer PRIMARY KEY DEFAULT 1,
  base_fee numeric(12,2) NOT NULL DEFAULT 0,
  default_commission_percent numeric(5,2) NOT NULL DEFAULT 10,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO onboarding_settings (id, base_fee, default_commission_percent)
VALUES (1, 0, 10)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS onboarding_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  max_employees integer,
  price_per_employee numeric(12,2) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_tiers_max_uq ON onboarding_tiers (max_employees);

-- Launch slabs from the spec: up to 10 = 60, up to 25 = 50, above 25 = 40 (per employee).
-- Seeded only when the table is empty. (A unique index does not stop a second open-ended NULL row, so ON CONFLICT
-- cannot make this idempotent on its own.)
INSERT INTO onboarding_tiers (max_employees, price_per_employee, sort_order)
SELECT v.max_employees, v.price, v.sort_order
FROM (VALUES (10, 60::numeric, 1), (25, 50::numeric, 2), (NULL::integer, 40::numeric, 3)) AS v(max_employees, price, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM onboarding_tiers);

CREATE TABLE IF NOT EXISTS onboarding_specialists (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone varchar(50) NOT NULL,
  photo_data_url text,
  commission_percent numeric(5,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS onboarding_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  include_onboarding boolean NOT NULL DEFAULT true,
  include_employees boolean NOT NULL DEFAULT false,
  employee_count integer NOT NULL DEFAULT 0,
  base_fee numeric(12,2) NOT NULL DEFAULT 0,
  employee_fee numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  contact_whatsapp varchar(20) NOT NULL,
  contact_email varchar(200) NOT NULL,
  contact_call varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending_payment',
  provider_order_id varchar(120),
  provider_payment_id varchar(120),
  paid_at timestamptz,
  specialist_id uuid REFERENCES users(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  commission_percent numeric(5,2),
  commission_amount numeric(12,2),
  release_count integer NOT NULL DEFAULT 0,
  flag_reason text,
  flagged_at timestamptz,
  completed_at timestamptz,
  satisfaction integer,
  rated_at timestamptz,
  rating_source varchar(10),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_requests_order_uq ON onboarding_requests (provider_order_id);
CREATE INDEX IF NOT EXISTS onboarding_requests_status_idx ON onboarding_requests (status);
CREATE INDEX IF NOT EXISTS onboarding_requests_specialist_idx ON onboarding_requests (specialist_id);
CREATE INDEX IF NOT EXISTS onboarding_requests_company_idx ON onboarding_requests (company_id);

CREATE TABLE IF NOT EXISTS onboarding_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES onboarding_requests(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event varchar(30) NOT NULL,
  note text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onboarding_events_request_idx ON onboarding_events (request_id);

COMMIT;
