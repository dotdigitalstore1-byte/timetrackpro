-- Monthly leave accrual (carry forward or lapse each month) and the 45-day photo retention window.
-- Run once against the database, e.g. `psql "$DATABASE_URL" -f migrations/2026-11-leave-accrual-and-photo-retention.sql`,
-- or let `npm run db:push` apply the matching schema change. Safe to re-run.

ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS leave_accrual_mode varchar(10) NOT NULL DEFAULT 'carry';

-- Photo retention needs no schema change: photos are cleared by the scheduled job
-- (POST /api/maintenance/purge-photos with "Authorization: Bearer $CRON_SECRET") and when an admin opens Photo audit.
