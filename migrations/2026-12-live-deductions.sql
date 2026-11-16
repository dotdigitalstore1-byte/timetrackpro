-- Same-day deductions and admin excuses for late arrivals. Idempotent.
BEGIN;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS excused boolean NOT NULL DEFAULT false;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS excused_reason text;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS excused_by uuid;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS excused_at timestamptz;
COMMIT;
