-- Super Admin "Links": the business registration link shown on the mobile login screen.
-- Idempotent. Run once per existing database:
--   psql "$DATABASE_URL" -f migrations/2027-03-links-and-registration.sql

BEGIN;
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS business_registration_url varchar(500);
COMMIT;
