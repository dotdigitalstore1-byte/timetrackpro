-- Employee "Get the app" page: store links and direct-download packages set by the Super Admin.
-- Idempotent. Run once per existing database:
--   psql "$DATABASE_URL" -f migrations/2027-02-app-downloads.sql

BEGIN;

ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS play_store_url varchar(500);
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS app_store_url varchar(500);

CREATE TABLE IF NOT EXISTS app_downloads (
  platform varchar(10) PRIMARY KEY CHECK (platform IN ('android', 'ios')),
  file_name varchar(200) NOT NULL,
  content_type varchar(100) NOT NULL,
  size_bytes integer NOT NULL,
  data bytea NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL
);

COMMIT;
