-- Run once against the production database (idempotent: safe to re-run).

-- 1) Late-percentage rule: punching in after N% of the shift marks the day absent. OFF by default.
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS absent_after_percent_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS absent_after_percent integer NOT NULL DEFAULT 50;

-- 2) Mid-cycle salary slips (OFF by default: slips only after a cycle is finalized, as before).
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS mid_cycle_slip_enabled boolean NOT NULL DEFAULT false;

-- 3) Company profile details shown on salary slips.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS legal_name varchar(200);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS website varchar(200);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tax_id varchar(50);

-- 4) Company logo, kept in its own table so it is not loaded on every request.
CREATE TABLE IF NOT EXISTS company_branding (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  logo_data_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5) Provisional (mid-cycle) slips keep a frozen snapshot of their figures from approval.
ALTER TABLE salary_slip_requests ADD COLUMN IF NOT EXISTS provisional boolean NOT NULL DEFAULT false;
ALTER TABLE salary_slip_requests ADD COLUMN IF NOT EXISTS snapshot jsonb;
