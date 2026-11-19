-- Fix: "value too long for type character varying(20)" when creating an onboarding specialist.
-- The role "onboarding_specialist" is 21 characters, but users.role was created as varchar(20).
-- Widening it to varchar(50) keeps all existing data and is safe to run more than once.
-- Run once per existing database: psql "$DATABASE_URL" -f migrations/2026-12-users-role-length.sql

BEGIN;

ALTER TABLE users ALTER COLUMN role TYPE varchar(50);

COMMIT;
