-- Run once against the production database (idempotent: safe to re-run).
-- Adds: periodic company-admin feedback responses, the platform event log (company deletions), and nothing else.

-- 1) Periodic feedback from company admins (three prompts per payroll cycle). No user id: answers are anonymous.
CREATE TABLE IF NOT EXISTS admin_feedback_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cycle_key varchar(7) NOT NULL,
  slot integer NOT NULL,
  questionnaire_version integer NOT NULL DEFAULT 1,
  answers jsonb NOT NULL,
  leniency_index integer NOT NULL,
  scrolled_to_end boolean NOT NULL DEFAULT false,
  responded_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_feedback_slot_uq ON admin_feedback_responses (company_id, cycle_key, slot);
CREATE INDEX IF NOT EXISTS admin_feedback_responded_idx ON admin_feedback_responses (responded_at);

-- 2) Platform event log. Keeps a record of company deletions after the company row is gone.
CREATE TABLE IF NOT EXISTS platform_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action varchar(60) NOT NULL,
  actor_id uuid REFERENCES users(id),
  company_id uuid,
  company_name varchar(200),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_events_created_idx ON platform_events (created_at);
