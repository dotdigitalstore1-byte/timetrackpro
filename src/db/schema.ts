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
  currency: varchar("currency", { length: 10 }).notNull().default("$"),
  approvalLevels: integer("approval_levels").notNull().default(1), // 1 or 2
  timezone: varchar("timezone", { length: 50 }).notNull().default("UTC"),
  weeklyOff: varchar("weekly_off", { length: 20 }).notNull().default("0,6"), // JS weekdays: 0=Sun … 6=Sat
  annualLeaveDays: integer("annual_leave_days").notNull().default(12),
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
  employeeCode: varchar("employee_code", { length: 50 }),
  // LEGACY free-text department. Superseded by the departments + employee_departments tables.
  // Kept only so `npm run db:backfill` can migrate old data; safe to drop afterwards.
  department: varchar("department", { length: 100 }),
  designation: varchar("designation", { length: 100 }),
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
  (t) => [index("leave_requests_company_employee_idx").on(t.companyId, t.employeeId)]
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
  salaryHoldDays: integer("salary_hold_days").notNull().default(0),
  salaryHoldAmount: numeric("salary_hold_amount", { precision: 12, scale: 2 }).notNull().default("0"),
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
export type Geofence = typeof geofences.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type CompanyHoliday = typeof companyHolidays.$inferSelect;