import Link from "next/link";

/** Slim notice shown to company admins during the free trial. Server-rendered; no client JavaScript needed. */
export default function TrialBanner({ daysLeft, employeeLimit }: { daysLeft: number; employeeLimit: number | null }) {
  const days = Math.max(0, daysLeft);
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <p>
        <span className="font-bold">Free trial:</span> {days} {days === 1 ? "day" : "days"} left
        {employeeLimit !== null && <> · up to {employeeLimit} people (managers included)</>}.
      </p>
      <Link href="/billing" className="font-bold text-amber-900 underline underline-offset-2 hover:text-amber-700">
        Choose a plan →
      </Link>
    </div>
  );
}
