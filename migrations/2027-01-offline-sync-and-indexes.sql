-- Offline sync replay protection and query-performance indexes.
-- Idempotent. Run once per existing database:
--   psql "$DATABASE_URL" -f migrations/2027-01-offline-sync-and-indexes.sql

BEGIN;

-- 1. Replay protection for writes queued on a device while offline.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key varchar(80) NOT NULL,
  status integer NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idempotency_user_key_uq ON idempotency_keys (user_id, key);

-- 2. Indexes for the hot read paths (leave balance by employee and dates, session cleanup).
CREATE INDEX IF NOT EXISTS leave_requests_employee_dates_idx ON leave_requests (employee_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

-- 3. Keep the replay table small: successful responses only need to survive long enough for retries.
-- (Pruned by the maintenance job; rows older than 30 days are safe to delete.)
CREATE INDEX IF NOT EXISTS idempotency_created_idx ON idempotency_keys (created_at);

COMMIT;
