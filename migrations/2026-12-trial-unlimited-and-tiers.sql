-- Unlimited employees during the free trial, and three larger plan tiers (200, 400, 600 employees).
-- Idempotent. Run once per existing database:
--   psql "$DATABASE_URL" -f migrations/2026-12-trial-unlimited-and-tiers.sql
-- Fresh installs get these tiers automatically. Edit prices later in Platform Admin > Plans.

BEGIN;

-- 1. Active trials no longer have a 4-person cap (NULL = unlimited). Paid subscriptions are not changed.
UPDATE companies
SET employee_limit = NULL
WHERE subscription_status = 'trial';

UPDATE subscriptions
SET employee_limit = NULL
WHERE plan = 'trial' AND status = 'trial';

-- 2. New tiers. Skipped when a plan with that name or that seat count already exists (seat counts are unique).
INSERT INTO plans (name, employee_limit, price, features, is_active, sort_order)
SELECT v.name, v.employee_limit, v.price, p.features, true, v.sort_order
FROM (VALUES
  ('Business 200', 200, 13999.00, 10),
  ('Business 400', 400, 24999.00, 11),
  ('Business 600', 600, 34999.00, 12)
) AS v(name, employee_limit, price, sort_order)
CROSS JOIN LATERAL (SELECT features FROM plans ORDER BY sort_order LIMIT 1) AS p
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE plans.name = v.name OR plans.employee_limit = v.employee_limit);

COMMIT;
