-- Run once against the production database (idempotent: safe to re-run).
-- 1) An unapproved day now delays the disbursement date (it no longer holds back money), the salary date is
--    configurable, and every finalized salary keeps its day-wise deduction log.

-- Settings: salary date (1–28, the day of the month after the cycle ends) and the hold switch (ON by default).
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS salary_disbursement_day integer NOT NULL DEFAULT 5;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS salary_hold_enabled boolean NOT NULL DEFAULT true;

-- Stored salary records.
ALTER TABLE salary_records ADD COLUMN IF NOT EXISTS salary_date timestamptz;
ALTER TABLE salary_records ADD COLUMN IF NOT EXISTS disbursement_date timestamptz;
ALTER TABLE salary_records ADD COLUMN IF NOT EXISTS deduction_ledger jsonb;

-- Old finalized and paid salaries were paid cycle end + salary_pay_delay_days, with no delay. Keep those dates.
-- Their deduction log stays NULL: it was never recorded, so it is not guessed at.
UPDATE salary_records r
   SET salary_date = r.period_end + make_interval(days => c.salary_pay_delay_days)
  FROM company_settings c
 WHERE c.company_id = r.company_id
   AND r.salary_date IS NULL
   AND r.period_end IS NOT NULL;
UPDATE salary_records
   SET disbursement_date = salary_date
 WHERE disbursement_date IS NULL
   AND salary_date IS NOT NULL;
