import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import type { LedgerEntry } from "@/lib/payroll";

// ---------------------------------------------------------------------------
// Multi-company SaaS schema. Every business table carries company_id and every
// query is scoped by company_id server-side (tenant isolation / RLS equivalent).
// ---------------------------------------------------------------------------

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  email: varchar("email", { length: 200 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  // Slip branding (set by the company admin under Settings → Company profile)
  legalName: varchar("legal_name", { length: 200 }),
  website: varchar("website", { length: 200 }),
  taxId: varchar("tax_id", { length: 50 }), // GSTIN / PAN / registration number, shown on slips
  status: varchar("status", { length: 20 }).notNull().default("active"), // active | suspended | deactivated
  subscriptionPlan: varchar("subscription_plan", { length: 50 }).notNull().default("trial"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  plan: varchar("plan", { length: 50 }).notNull().default("trial"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  status: varchar("status", { length: 20 }).notNull().default("active"), // active | expired | cancelled
  startDate: timestamp("start_date", { withTimezone: true }).notNull().defaultNow(),
  endDate: timestamp("end_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 200 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: varchar("full_name", { length: 200 }).notNull(),
  role: varchar("role", { length: 20 }).notNull().default("employee"), // super_admin | company_admin | manager | employee
  // Manager powers granted by the company admin (see src/lib/access.ts). Empty for every other role.
  managerPermissions: jsonb("manager_permissions").$type<string[]>().notNull().default([]),
  phone: varchar("phone", { length: 50 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const companySettings = pgTable("company_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .unique()
    .references(() => companies.id, { onDelete: "cascade" }),
  shiftStart: varchar("shift_start", { length: 10 }).notNull().default("09:00"),
  shiftEnd: varchar("shift_end", { length: 10 }).notNull().default("18:00"),
  graceMinutes: integer("grace_minutes").notNull().default(5),
  lateThresholdMinutes: integer("late_threshold_minutes").notNull().default(30), // beyond this => half day
  halfDayThresholdMinutes: integer("half_day_threshold_minutes").notNull().default(120),
  lateDeductionType: varchar("late_deduction_type", { length: 20 }).notNull().default("percentage"), // percentage | fixed
  lateDeductionValue: numeric("late_deduction_value", { precision: 10, scale: 2 }).notNull().default("5"),
  halfDayDeductionType: varchar("half_day_deduction_type", { length: 20 }).notNull().default("percentage"),
  halfDayDeductionValue: numeric("half_day_deduction_value", { precision: 10, scale: 2 }).notNull().default("50"),
  leaveDeductionType: varchar("leave_deduction_type", { length: 20 }).notNull().default("percentage"),
  leaveDeductionValue: numeric("leave_deduction_value", { precision: 10, scale: 2 }).notNull().default("100"),
  unapprovedHoldDays: integer("unapproved_hold_days").notNull().default(2),
  workDaysPerMonth: integer("work_days_per_month").notNull().default(26),
  currency: varchar("currency", { length: 10 }).notNull().default("₹"),
  approvalLevels: integer("approval_levels").notNull().default(1), // 1 or 2
  timezone: varchar("timezone", { length: 50 }).notNull().default("UTC"),
  weeklyOff: varchar("weekly_off", { length: 20 }).notNull().default("0,6"), // JS weekdays: 0=Sun … 6=Sat
  annualLeaveDays: integer("annual_leave_days").notNull().default(12),

  // ---- Rules: early leave (all default OFF so existing companies behave exactly as before)
  earlyLeaveGraceMinutes: integer("early_leave_grace_minutes").notNull().default(5), // leaving up to this early is fine
  earlyLeaveHalfDayMinutes: integer("early_leave_half_day_minutes").notNull().default(0), // leaving MORE than this early = half day (0 = off)
  earlyLeaveDeductionType: varchar("early_leave_deduction_type", { length: 20 }).notNull().default("percentage"),
  earlyLeaveDeductionValue: numeric("early_leave_deduction_value", { precision: 10, scale: 2 }).notNull().default("0"),
  // ---- Rules: "every N late marks cost X days of salary" (0 = off)
  lateMarksLimit: integer("late_marks_limit").notNull().default(0),
  lateMarksPenaltyDays: numeric("late_marks_penalty_days", { precision: 4, scale: 2 }).notNull().default("0.5"),
  // ---- Rules: overtime (off by default)
  overtimeEnabled: boolean("overtime_enabled").notNull().default(false),
  overtimeMinMinutes: integer("overtime_min_minutes").notNull().default(30), // must stay at least this long past shift end
  overtimeRate: numeric("overtime_rate", { precision: 4, scale: 2 }).notNull().default("1.5"), // pay multiplier
  overtimeMaxMinutesPerDay: integer("overtime_max_minutes_per_day").notNull().default(240),
  // ---- Salary cycle
  salaryCycleStartDay: integer("salary_cycle_start_day").notNull().default(1), // 1 = calendar month; 26 = 26th -> 25th
  // LEGACY: only used to date finalized salaries from before salary_date was stored. Not shown in Rules any more.
  salaryPayDelayDays: integer("salary_pay_delay_days").notNull().default(5),
  // Salary date: the salary of a cycle is paid on this day of the month AFTER the cycle ends (1–28).
  salaryDisbursementDay: integer("salary_disbursement_day").notNull().default(5),
  // Salary hold: each unapproved day delays the disbursement date by unapprovedHoldDays (ON by default).
  salaryHoldEnabled: boolean("salary_hold_enabled").notNull().default(true),
  dailyRateBasis: varchar("daily_rate_basis", { length: 10 }).notNull().default("fixed"), // legacy: salaries now always use a 30-day month

  // ---- Weekly-off work & comp-off (Extra pay is OFF by default)
  extraPayEnabled: boolean("extra_pay_enabled").notNull().default(false), // pay unused comp-off at cycle end
  extraPayRate: numeric("extra_pay_rate", { precision: 4, scale: 2 }).notNull().default("1"), // × daily rate per day

  // ---- Sunday / holiday pay cut: when an employee takes unauthorized leave around a weekly off or holiday
  holidayDeductionEnabled: boolean("holiday_deduction_enabled").notNull().default(false),
  holidayDeductionTriggerCount: integer("holiday_deduction_trigger_count").notNull().default(2), // 1 or 2 adjacent unauthorized days

  // ---- Late-percentage rule: punching in after this % of the shift has passed marks the day absent (OFF by default)
  absentAfterPercentEnabled: boolean("absent_after_percent_enabled").notNull().default(false),
  absentAfterPercent: integer("absent_after_percent").notNull().default(50),

  // ---- Salary slips: allow a slip for the cycle that is still running (e.g. an employee resigning mid-month)
  midCycleSlipEnabled: boolean("mid_cycle_slip_enabled").notNull().default(false),

  // ---- Leave accrual: 1 leave per month. "carry" = balance accumulates; "lapse" = a month's leave must be used that month
  leaveAccrualMode: varchar("leave_accrual_mode", { length: 10 }).notNull().default("carry"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const companyHolidays = pgTable(
  "company_holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    holidayDate: timestamp("holiday_date", { withTimezone: true }).notNull(), // UTC midnight of the local date
    name: varchar("name", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("company_holidays_company_date_uq").on(t.companyId, t.holidayDate)]
);

// Fixed-window counters for login / registration throttling (works across serverless instances).
export const rateLimits = pgTable("rate_limits", {
  key: varchar("key", { length: 200 }).primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});

// Work locations. Each location is also a geofence: employees can only punch while inside the
// radius of one of the locations assigned to them (or any active company location if none assigned).
export const geofences = pgTable(
  "geofences",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 200 }).notNull().default("Head Office"),
  address: text("address"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: numeric("longitude", { precision: 10, scale: 7 }).notNull(),
  radiusMeters: integer("radius_meters").notNull().default(200),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("geofences_company_idx").on(t.companyId)]
);

// Company departments: unlimited per company, names unique (case-insensitive) within a company.
export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("departments_company_idx").on(t.companyId),
    uniqueIndex("departments_company_name_uq").on(t.companyId, sql`lower(${t.name})`),
  ]
);

export const employees = pgTable(
  "employees",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  employeeCode: varchar("employee_code", { length: 50 }).notNull(),
  // LEGACY free-text department. Superseded by the departments + employee_departments tables.
  // Kept only so `npm run db:backfill` can migrate old data; safe to drop afterwards.
  department: varchar("department", { length: 100 }),
  designation: varchar("designation", { length: 100 }),
  // Personal shift ("HH:MM", company local time). null = use the company default shift.
  shiftStart: varchar("shift_start", { length: 5 }),
  shiftEnd: varchar("shift_end", { length: 5 }),
  basicSalary: numeric("basic_salary", { precision: 12, scale: 2 }).notNull().default("0"),
  hireDate: timestamp("hire_date", { withTimezone: true }).notNull().defaultNow(),
  managerId: uuid("manager_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("employees_company_idx").on(t.companyId),
    index("employees_user_idx").on(t.userId),
    index("employees_manager_idx").on(t.managerId),
    // every employee has a code, and no two employees in a company share one
    uniqueIndex("employees_company_code_uniq").on(t.companyId, t.employeeCode),
  ]
);

// An employee can belong to many departments and work at many locations.
export const employeeDepartments = pgTable(
  "employee_departments",
  {
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.employeeId, t.departmentId] }),
    index("employee_departments_department_idx").on(t.departmentId),
  ]
);

// Departments and work locations a manager is responsible for. Many managers can share one department.
export const managerDepartments = pgTable(
  "manager_departments",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").notNull().references(() => departments.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.departmentId] }), index("manager_departments_department_idx").on(t.departmentId)]
);

export const managerLocations = pgTable(
  "manager_locations",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").notNull().references(() => geofences.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.locationId] }), index("manager_locations_location_idx").on(t.locationId)]
);

export const employeeLocations = pgTable(
  "employee_locations",
  {
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => geofences.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.employeeId, t.locationId] }),
    index("employee_locations_location_idx").on(t.locationId),
  ]
);

export const attendance = pgTable(
  "attendance",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  workDate: timestamp("work_date", { withTimezone: true }).notNull(),
  punchInTime: timestamp("punch_in_time", { withTimezone: true }),
  punchOutTime: timestamp("punch_out_time", { withTimezone: true }),
  punchInPhoto: text("punch_in_photo"),
  punchOutPhoto: text("punch_out_photo"),
  punchInLat: numeric("punch_in_lat", { precision: 10, scale: 7 }),
  punchInLng: numeric("punch_in_lng", { precision: 10, scale: 7 }),
  punchOutLat: numeric("punch_out_lat", { precision: 10, scale: 7 }),
  punchOutLng: numeric("punch_out_lng", { precision: 10, scale: 7 }),
  status: varchar("status", { length: 20 }).notNull().default("present"), // present | late | half_day | absent | on_leave
  isManual: boolean("is_manual").notNull().default(false),
  note: text("note"),
  earlyLeaveMinutes: integer("early_leave_minutes").notNull().default(0), // minutes before shift end (set at punch-out)
  overtimeMinutes: integer("overtime_minutes").notNull().default(0), // raw minutes after shift end (set at punch-out)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("attendance_employee_day_uq").on(t.employeeId, t.workDate),
    index("attendance_company_date_idx").on(t.companyId, t.workDate),
  ]
);

export const attendanceAudit = pgTable("attendance_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  attendanceId: uuid("attendance_id")
    .notNull()
    .references(() => attendance.id, { onDelete: "cascade" }),
  changedBy: uuid("changed_by").notNull().references(() => users.id),
  field: varchar("field", { length: 100 }).notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leaveRequests = pgTable(
  "leave_requests",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  leaveType: varchar("leave_type", { length: 50 }).notNull().default("leave"), // only leave category
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  endDate: timestamp("end_date", { withTimezone: true }).notNull(),
  days: numeric("days", { precision: 5, scale: 1 }).notNull().default("1"),
  reason: text("reason"),
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending | approved | rejected | cancelled
  level1Status: varchar("level1_status", { length: 20 }).notNull().default("pending"),
  level2Status: varchar("level2_status", { length: 20 }).notNull().default("pending"),
  currentLevel: integer("current_level").notNull().default(1),
  approvedBy: uuid("approved_by").references(() => users.id),
  rejectedBy: uuid("rejected_by").references(() => users.id),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("leave_requests_company_employee_idx").on(t.companyId, t.employeeId),
    index("leave_requests_company_status_idx").on(t.companyId, t.status),
  ]
);

export const salaryRecords = pgTable(
  "salary_records",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  basicSalary: numeric("basic_salary", { precision: 12, scale: 2 }).notNull().default("0"),
  dailyRate: numeric("daily_rate", { precision: 12, scale: 2 }).notNull().default("0"),
  presentDays: numeric("present_days", { precision: 6, scale: 1 }).notNull().default("0"),
  absentDays: numeric("absent_days", { precision: 6, scale: 1 }).notNull().default("0"),
  lateDays: integer("late_days").notNull().default(0),
  halfDays: integer("half_days").notNull().default(0),
  leaveDays: numeric("leave_days", { precision: 6, scale: 1 }).notNull().default("0"),
  unapprovedLeaveCount: integer("unapproved_leave_count").notNull().default(0),
  attendanceSalary: numeric("attendance_salary", { precision: 14, scale: 2 }).notNull().default("0"),
  lateDeduction: numeric("late_deduction", { precision: 12, scale: 2 }).notNull().default("0"),
  halfDayDeduction: numeric("half_day_deduction", { precision: 12, scale: 2 }).notNull().default("0"),
  leaveDeduction: numeric("leave_deduction", { precision: 12, scale: 2 }).notNull().default("0"),
  otherDeductions: jsonb("other_deductions").$type<{ label: string; amount: number }[]>().notNull().default([]),
  // bonuses / allowances added for this cycle
  additions: jsonb("additions").$type<{ label: string; amount: number }[]>().notNull().default([]),
  earlyLeaveDays: integer("early_leave_days").notNull().default(0),
  earlyLeaveDeduction: numeric("early_leave_deduction", { precision: 12, scale: 2 }).notNull().default("0"),
  overtimeMinutes: integer("overtime_minutes").notNull().default(0),
  overtimePay: numeric("overtime_pay", { precision: 12, scale: 2 }).notNull().default("0"),
  // weekly-off work and comp-off for this cycle
  weekOffWorkedDays: integer("week_off_worked_days").notNull().default(0),
  compOffUsed: integer("comp_off_used").notNull().default(0), // leave days covered by comp-off
  compOffUnused: integer("comp_off_unused").notNull().default(0), // comp-off left at cycle end
  extraPayDays: integer("extra_pay_days").notNull().default(0),
  extraPayAmount: numeric("extra_pay_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  // the exact pay period this record covers (kept so history stays right if the cycle setting changes later)
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  holidayDeductionDays: integer("holiday_deduction_days").notNull().default(0),
  holidayDeduction: numeric("holiday_deduction", { precision: 12, scale: 2 }).notNull().default("0"),
  salaryHoldDays: integer("salary_hold_days").notNull().default(0),
  salaryHoldAmount: numeric("salary_hold_amount", { precision: 12, scale: 2 }).notNull().default("0"), // legacy money hold; always 0 for new calculations
  // The date the salary is due, and the date it is actually disbursed after any unapproved-day delay.
  salaryDate: timestamp("salary_date", { withTimezone: true }),
  disbursementDate: timestamp("disbursement_date", { withTimezone: true }),
  // The day-wise deduction log, frozen at finalization. NULL = finalized before the log existed.
  deductionLedger: jsonb("deduction_ledger").$type<LedgerEntry[]>(),
  totalDeductions: numeric("total_deductions", { precision: 14, scale: 2 }).notNull().default("0"),
  netPayable: numeric("net_payable", { precision: 14, scale: 2 }).notNull().default("0"),
  status: varchar("status", { length: 20 }).notNull().default("draft"), // draft | finalized | paid
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  finalizedBy: uuid("finalized_by").references(() => users.id),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("salary_employee_month_uq").on(t.employeeId, t.year, t.month)]
);

export const salaryHolds = pgTable(
  "salary_holds",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  occurrenceDate: timestamp("occurrence_date", { withTimezone: true }).notNull(),
  days: integer("days").notNull().default(2),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  reason: text("reason").notNull().default("Unapproved leave"),
  status: varchar("status", { length: 20 }).notNull().default("active"), // active | released
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  releasedBy: uuid("released_by").references(() => users.id),
  },
  (t) => [uniqueIndex("salary_hold_occurrence_uq").on(t.employeeId, t.occurrenceDate)]
);

// An employee asks for the slip of a finalized cycle; the admin approves it. Approved slips are downloadable
// by the employee until `availableUntil` (SLIP_ACCESS_DAYS after approval), then the employee loses access.
export const salarySlipRequests = pgTable(
  "salary_slip_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    month: integer("month").notNull(), // salary cycle, named by the month it ends in
    status: varchar("status", { length: 20 }).notNull().default("pending"), // pending | approved | rejected
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => users.id),
    rejectionReason: text("rejection_reason"),
    availableUntil: timestamp("available_until", { withTimezone: true }),
    // Set when the slip is for a cycle that was still running at approval: the figures are frozen then, as a
    // provisional slip. Once the cycle is finalized, the final figures are shown instead.
    provisional: boolean("provisional").notNull().default(false),
    snapshot: jsonb("snapshot").$type<Record<string, unknown> | null>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("salary_slip_requests_employee_month_uq").on(t.employeeId, t.year, t.month),
    index("salary_slip_requests_company_status_idx").on(t.companyId, t.status),
  ]
);

// The company logo, kept apart from the companies row so it is not loaded on every authenticated request.
export const companyBranding = pgTable("company_branding", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  logoDataUrl: text("logo_data_url"), // small PNG/JPEG/WebP data URL (see /api/settings)
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => users.id),
  action: varchar("action", { length: 100 }).notNull(),
  entity: varchar("entity", { length: 100 }).notNull(),
  entityId: uuid("entity_id"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Relations (used by queries with joins)
export const usersRelations = relations(users, ({ one }) => ({
  company: one(companies, { fields: [users.companyId], references: [companies.id] }),
}));

export const employeesRelations = relations(employees, ({ one }) => ({
  user: one(users, { fields: [employees.userId], references: [users.id] }),
  company: one(companies, { fields: [employees.companyId], references: [companies.id] }),
}));

export type Company = typeof companies.$inferSelect;
export type User = typeof users.$inferSelect;
export type Employee = typeof employees.$inferSelect;
export type AttendanceRecord = typeof attendance.$inferSelect;
export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type SalaryRecord = typeof salaryRecords.$inferSelect;
export type SalaryHold = typeof salaryHolds.$inferSelect;
export type CompanySettings = typeof companySettings.$inferSelect;
export type SalarySlipRequest = typeof salarySlipRequests.$inferSelect;
export type Geofence = typeof geofences.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type CompanyHoliday = typeof companyHolidays.$inferSelect;