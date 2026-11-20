-- Expert Onboarding workflow + employee usernames.
-- Safe to run more than once.
-- Run once per database: psql "$DATABASE_URL" -f migrations/2026-12-specialist-workflow-usernames.sql

BEGIN;

-- Employee usernames. Stored lowercase and unique across the whole platform (all companies).
ALTER TABLE users ADD COLUMN IF NOT EXISTS username varchar(30);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_uq ON users (username);

-- Client details captured at checkout, shown to the specialist in My Work.
-- Existing requests (created before this update) keep these empty.
ALTER TABLE onboarding_requests ADD COLUMN IF NOT EXISTS contact_name varchar(120);
ALTER TABLE onboarding_requests ADD COLUMN IF NOT EXISTS setup_requirements text;

COMMIT;
