-- Run once against the production database (idempotent: safe to re-run).
-- 1) Sunday / holiday pay cut setting (OFF by default; existing companies see no change until switched on).
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS holiday_deduction_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS holiday_deduction_trigger_count integer NOT NULL DEFAULT 2;

-- 2) Stored per-cycle figures. Old finalized records keep 0 (their history is never recalculated).
ALTER TABLE salary_records ADD COLUMN IF NOT EXISTS holiday_deduction_days integer NOT NULL DEFAULT 0;
ALTER TABLE salary_records ADD COLUMN IF NOT EXISTS holiday_deduction numeric(12,2) NOT NULL DEFAULT 0;

-- 3) Salary slip requests (employee asks, admin approves, employee downloads for 90 days).
CREATE TABLE IF NOT EXISTS salary_slip_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES users(id),
  rejection_reason text,
  available_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS salary_slip_requests_employee_month_uq ON salary_slip_requests (employee_id, year, month);
CREATE INDEX IF NOT EXISTS salary_slip_requests_company_status_idx ON salary_slip_requests (company_id, status);
