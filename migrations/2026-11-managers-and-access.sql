-- Managers: departments + locations they are responsible for, and the powers the company admin grants them.
-- Safe to re-run. Existing managers keep their old abilities (approve leave, view photos and reports) and
-- receive the departments/locations of their own employee record plus those of the people who reported to them.

ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_permissions jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS manager_departments (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, department_id)
);
CREATE INDEX IF NOT EXISTS manager_departments_department_idx ON manager_departments (department_id);

CREATE TABLE IF NOT EXISTS manager_locations (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, location_id)
);
CREATE INDEX IF NOT EXISTS manager_locations_location_idx ON manager_locations (location_id);

CREATE INDEX IF NOT EXISTS leave_requests_company_status_idx ON leave_requests (company_id, status);

-- Backfill: departments/locations of the manager's own record and of the employees who reported to them.
INSERT INTO manager_departments (user_id, department_id)
SELECT DISTINCT u.id, ed.department_id
FROM users u
JOIN employees me ON me.user_id = u.id
JOIN employee_departments ed ON ed.employee_id = me.id
   OR ed.employee_id IN (SELECT r.id FROM employees r WHERE r.manager_id = me.id)
WHERE u.role = 'manager'
ON CONFLICT DO NOTHING;

INSERT INTO manager_locations (user_id, location_id)
SELECT DISTINCT u.id, el.location_id
FROM users u
JOIN employees me ON me.user_id = u.id
JOIN employee_locations el ON el.employee_id = me.id
   OR el.employee_id IN (SELECT r.id FROM employees r WHERE r.manager_id = me.id)
WHERE u.role = 'manager'
ON CONFLICT DO NOTHING;

UPDATE users
SET manager_permissions = '["approve_leaves","view_photos","view_reports"]'::jsonb
WHERE role = 'manager' AND manager_permissions = '[]'::jsonb;

-- Managers are supervisors, not punching staff: their old employee record is no longer used for attendance or leave.
