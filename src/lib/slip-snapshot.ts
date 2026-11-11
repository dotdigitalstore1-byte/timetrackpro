import type { SalaryBreakdown } from "@/lib/salary-breakdown";

/** The frozen figures of a provisional (mid-cycle) slip, captured when the admin approves the request. */
export interface SlipSnapshot {
  period: { start: string; end: string };
  salaryDate: string;
  disbursementDate: string;
  /** Snapshots made before the salary date existed carry only the old single pay date. */
  payDate?: string;
  asOf: string; // company-local date of approval
  breakdown: SalaryBreakdown;
}
