-- ============================================================================
-- SaaS billing, plan builder, 20-day trial and email OTP sign-up.
-- Idempotent: safe to run more than once. Run once per existing database:
--   psql "$DATABASE_URL" -f migrations/2026-11-saas-billing-and-otp.sql
-- (Fresh installs using `npm run db:push` get the same schema from src/db/schema.ts;
--  the plan and billing-length seeds are also created on first use by the app.)
-- ============================================================================
BEGIN;

-- 1. Access window and seat limit on every company.
--    access_until NULL = legacy account with no expiry and unlimited seats (existing paid/manual accounts).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS access_until timestamptz;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS employee_limit integer;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_status varchar(20) NOT NULL DEFAULT 'legacy';

-- 2. Admin-editable plans (seat tiers). Every feature is included on every plan.
CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  employee_limit integer NOT NULL,
  price numeric(12,2) NOT NULL,
  compare_at_price numeric(12,2),
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS plans_employee_limit_uq ON plans (employee_limit);

-- 3. Billing lengths and their discounts.
CREATE TABLE IF NOT EXISTS billing_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  months integer NOT NULL,
  label varchar(60) NOT NULL,
  discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_cycles_months_uq ON billing_cycles (months);

-- 4. Subscription history links to the plan, its seats and its billing length.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES plans(id) ON DELETE SET NULL;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS employee_limit integer;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_months integer;

-- 5. Sign-ups waiting for their email code (the company is created only after verification).
CREATE TABLE IF NOT EXISTS pending_registrations (
  email varchar(200) PRIMARY KEY,
  payload jsonb NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  last_sent_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 6. Launch price list (INR per month). Existing rows are left alone.
INSERT INTO plans (name, employee_limit, price, features, is_active, sort_order) VALUES
  ('Solo', 1, 99.00, jsonb_build_array('Photo-verified punch in/out with GPS geofencing', 'Leave management with approval workflow', 'Payroll, salary slips and payment holds', 'Rules for late marks, half days, overtime and deductions', 'Unlimited departments, locations and shifts', 'Managers with their own permissions', 'Reports exported to Excel, CSV and PDF', 'Company agreements and notice periods', 'Installable mobile app and web app', 'Historical data kept for the life of your account'), true, 0),
  ('Duo', 2, 200.00, jsonb_build_array('Photo-verified punch in/out with GPS geofencing', 'Leave management with approval workflow', 'Payroll, salary slips and payment holds', 'Rules for late marks, half days, overtime and deductions', 'Unlimited departments, locations and shifts', 'Managers with their own permissions', 'Reports exported to Excel, CSV and PDF', 'Company agreements and notice periods', 'Installable mobile app and web app', 'Historical data kept for the life of your account'), true, 1),
  ('Trio', 3, 300.00, jsonb_build_array('Photo-verified punch in/out with GPS geofencing', 'Leave management with approval workflow', 'Payroll, salary slips and payment holds', 'Rules for late marks, half days, overtime and deductions', 'Unlimited departments, locations and shifts', 'Managers with their own permissions', 'Reports exported to Excel, CSV and PDF', 'Company agreements and notice periods', 'Installable mobile app and web app', 'Historical data kept for the life of your account'), true, 2),
  ('Quad', 4, 400.00, jsonb_build_array('Photo-verified punch in/out with GPS geofencing', 'Leave management with approval workflow', 'Payroll, salary slips and payment holds', 'Rules for late marks, half days, overtime and deductions', 'Unlimited departments, locations and shifts', 'Managers with their own permissions', 'Reports exported to Excel, CSV and PDF', 'Company agreements and notice periods', 'Installable mobile app and web app', 'Historical data kept for the life of your account'), true, 3),
  ('Team 5', 5, 500.00, jsonb_build_array('Photo-verified punch in/out with GPS geofencing', 'Leave management with approval workflow', 'Payroll, salary slips and payment holds', 'Rules for late marks, half days, overtime and deductions', 'Unlimited departments, locations and shifts', 'Managers with their own permissions', 'Reports exported to Excel, CSV and PDF', 'Company agreements and notice periods', 'Installable mobile app and web app', 'Historical data kept for the life of your account'), true, 4),
  ('Team 10', 10, 900.00, jsonb_build_array('Photo-verified punch in/out with GPS geofencing', 'Leave management with approval workflow', 'Payroll, salary slips and payment holds', 'Rules for late marks, half days, overtime and deductions', 'Unlimited departments, locations and shifts', 'Managers with their own permissions', 'Reports exported to Excel, CSV and PDF', 'Company agreements and notice periods', 'Installable mobile app and web app', 'Historical data kept for the life of your account'), true, 5),
  ('Team 20', 20, 1749.00, jsonb_build_array('Photo-verified punch in/out with GPS geofencing', 'Leave management with approval workflow', 'Payroll, salary slips and payment holds', 'Rules for late marks, half days, overtime and deductions', 'Unlimited departments, locations and shifts', 'Managers with their own permissions', 'Reports exported to Excel, CSV and PDF', 'Company agreements and notice periods', 'Installable mobile app and web app', 'Historical data kept for the life of your account'), true, 6),
  ('Team 30', 30, 2499.00, jsonb_build_array('Photo-verified punch in/out with GPS geofencing', 'Leave management with approval workflow', 'Payroll, salary slips and payment holds', 'Rules for late marks, half days, overtime and deductions', 'Unlimited departments, locations and shifts', 'Managers with their own permissions', 'Reports exported to Excel, CSV and PDF', 'Company agreements and notice periods', 'Installable mobile app and web app', 'Historical data kept for the life of your account'), true, 7),
  ('Business 50', 50, 2999.00, jsonb_build_array('Photo-verified punch in/out with GPS geofencing', 'Leave management with approval workflow', 'Payroll, salary slips and payment holds', 'Rules for late marks, half days, overtime and deductions', 'Unlimited departments, locations and shifts', 'Managers with their own permissions', 'Reports exported to Excel, CSV and PDF', 'Company agreements and notice periods', 'Installable mobile app and web app', 'Historical data kept for the life of your account'), true, 8),
  ('Business 100', 100, 7999.00, jsonb_build_array('Photo-verified punch in/out with GPS geofencing', 'Leave management with approval workflow', 'Payroll, salary slips and payment holds', 'Rules for late marks, half days, overtime and deductions', 'Unlimited departments, locations and shifts', 'Managers with their own permissions', 'Reports exported to Excel, CSV and PDF', 'Company agreements and notice periods', 'Installable mobile app and web app', 'Historical data kept for the life of your account'), true, 9)
ON CONFLICT (employee_limit) DO NOTHING;

INSERT INTO billing_cycles (months, label, discount_percent, is_active, sort_order) VALUES
  (1, '1 month', 0.00, true, 0),
  (6, '6 months', 10.00, true, 1),
  (12, '12 months', 20.00, true, 2)
ON CONFLICT (months) DO NOTHING;

-- 7. Existing trial accounts: they move onto the new trial rules (4 seats). They get ONE 20-day window that starts
--    at this migration, rather than being locked out the moment the migration runs. Runs once (access_until is then set).
UPDATE companies
   SET subscription_status = 'trial',
       access_until = now() + interval '20 days',
       employee_limit = 4
 WHERE subscription_plan = 'trial' AND access_until IS NULL;

UPDATE subscriptions
   SET status = 'trial', employee_limit = 4
 WHERE plan = 'trial' AND employee_limit IS NULL AND status = 'active';

-- Every other existing company stays on a legacy (no expiry, unlimited seats) account until a platform admin
-- grants or sets a plan from the Companies page.

COMMIT;
