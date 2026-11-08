-- 1) Amounts are in Indian Rupees everywhere.
UPDATE company_settings SET currency = '₹' WHERE currency IS DISTINCT FROM '₹';
ALTER TABLE company_settings ALTER COLUMN currency SET DEFAULT '₹';

-- 2) Every employee has a unique employee code.
-- Tidy codes that are only spaces, then trim and upper-case what is there.
UPDATE employees SET employee_code = NULL WHERE employee_code IS NOT NULL AND BTRIM(employee_code) = '';
UPDATE employees SET employee_code = UPPER(REPLACE(employee_code, ' ', '')) WHERE employee_code IS NOT NULL;

-- Duplicates within a company (case-insensitive): keep the oldest code, give the others a suffix (-2, -3...).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id, employee_code ORDER BY created_at, id) AS rn
  FROM employees
  WHERE employee_code IS NOT NULL
)
UPDATE employees e SET employee_code = e.employee_code || '-' || r.rn
FROM ranked r
WHERE e.id = r.id AND r.rn > 1;

-- Employees without a code get the next EMP-nnnn numbers, after the highest number already used in the company.
WITH maxn AS (
  SELECT company_id,
         COALESCE(MAX(CASE WHEN employee_code ~ '^EMP-[0-9]+$' THEN SUBSTRING(employee_code FROM 5)::int END), 0) AS m
  FROM employees
  GROUP BY company_id
),
numbered AS (
  SELECT e.id, e.company_id, ROW_NUMBER() OVER (PARTITION BY e.company_id ORDER BY e.created_at, e.id) AS rn
  FROM employees e
  WHERE e.employee_code IS NULL
)
UPDATE employees e
SET employee_code = 'EMP-' || LPAD((m.m + n.rn)::text, 4, '0')
FROM numbered n
JOIN maxn m ON m.company_id = n.company_id
WHERE e.id = n.id;

ALTER TABLE employees ALTER COLUMN employee_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS employees_company_code_uniq ON employees (company_id, employee_code);
