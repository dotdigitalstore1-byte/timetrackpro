-- Fix: "value too long for type character varying(20)" when creating an onboarding specialist.
-- Password hashes are stored as "salt:hash" (about 161 characters). Some databases were created
-- with users.password_hash as varchar(20), which rejects every new account. The application
-- schema (src/db/schema.ts) has always declared this column as text.
-- Widening varchar to text keeps all existing data and is safe to run more than once.
-- Run once per existing database: psql "$DATABASE_URL" -f migrations/2026-12-users-password-hash-text.sql

BEGIN;

ALTER TABLE users ALTER COLUMN password_hash TYPE text;

COMMIT;
