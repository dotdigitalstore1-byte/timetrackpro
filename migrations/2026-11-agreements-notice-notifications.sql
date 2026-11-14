-- Run once against the production database (idempotent: safe to re-run).
-- Adds: company agreements (pop-up + acknowledgements), notice periods, notice policy, and notification read state.
-- The company logo needs no change: it already lives in company_branding.

-- 1) Notification centre: when each user last opened it (items newer than this are unread).
ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_seen_at timestamptz;

-- 2) Notice period policy (Notice period page). Defaults: 30 days standard, up to 90, early release allowed.
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS notice_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS notice_default_days integer NOT NULL DEFAULT 30;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS notice_max_days integer NOT NULL DEFAULT 90;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS notice_allow_early_release boolean NOT NULL DEFAULT true;

-- 3) Company agreements.
CREATE TABLE IF NOT EXISTS company_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  body text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1,
  published_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_agreements_company_idx ON company_agreements (company_id);

-- 4) Employee answers to an agreement version (one per agreement, version and company day).
CREATE TABLE IF NOT EXISTS agreement_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agreement_id uuid NOT NULL REFERENCES company_agreements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version integer NOT NULL,
  response varchar(20) NOT NULL,
  work_date timestamptz NOT NULL,
  permanent boolean NOT NULL DEFAULT false,
  responded_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agreement_ack_uq ON agreement_acknowledgements (agreement_id, user_id, version, work_date);
CREATE INDEX IF NOT EXISTS agreement_ack_company_idx ON agreement_acknowledgements (company_id);

-- 5) Notice periods.
CREATE TABLE IF NOT EXISTS notice_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status varchar(20) NOT NULL DEFAULT 'requested',
  source varchar(20) NOT NULL DEFAULT 'employee',
  reason text,
  resignation_confirmed boolean NOT NULL DEFAULT false,
  signed_name varchar(200),
  signed_at timestamptz,
  requested_at timestamptz NOT NULL DEFAULT now(),
  start_date timestamptz,
  notice_days integer,
  last_working_day timestamptz,
  decided_at timestamptz,
  decided_by uuid REFERENCES users(id),
  decision_note text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notice_periods_company_status_idx ON notice_periods (company_id, status);
CREATE INDEX IF NOT EXISTS notice_periods_employee_idx ON notice_periods (employee_id);
-- An employee can have only one open notice (requested or active) at a time.
CREATE UNIQUE INDEX IF NOT EXISTS notice_one_open_uq ON notice_periods (employee_id) WHERE status IN ('requested', 'active');
