# TimeTrack Pro — multi-company attendance & salary SaaS

Next.js 16 (App Router) + TypeScript + Tailwind + PostgreSQL (Drizzle ORM). Installable PWA that works as
a mobile app (Android/desktop install) and a responsive web app.

## Features

* **Attendance** with photo-verified punch in/out, GPS geofencing, late/half-day automation and an audit
  trail for every correction.
* **Leave management** with leave balance, advance-request rules and 1- or 2-level approvals.
* **Payroll** with attendance-based salary, configurable late/half-day/leave deductions, releasable salary
  holds, month finalization and paid history.
* **Employee shifts** – every employee has their own punch-in and punch-out time (set when creating the employee,
  editable later). Lateness, cool-off and early leave are measured against it.
* **Rules** (company admin) – cool-off (grace) time, half-day cut-off, late marks, early leave, overtime, deductions
  and the salary cycle, each with a live example.
* **Salary cycle** – calendar month or a custom cycle (e.g. 26th → 25th) with a pay date; bonuses/allowances and
  overtime appear on the payslip.
* **Departments** – a company admin can add unlimited departments (rename, deactivate, delete).
* **Work locations** – a company admin can add unlimited locations (name, address, GPS point + punch radius).
* **Employees** with search, manager assignment, **one or more departments and work locations each**,
  deactivate/reactivate and admin password reset. Department and location are required when adding an employee.
* **Self-service profile** for every user: update name/phone and change password securely.
* **Reports** (daily/weekly/monthly/yearly) with a department filter, exported to Excel, CSV and PDF.
* **Billing-ready platform admin** for creating companies, plans and account status.
* **Responsive UI**: tables become touch-friendly cards on phones, bottom navigation, safe-area support,
  install prompt and offline fallback.
* **Reliable data fetching**: one shared session request, request timeouts, typed API errors and error
  boundaries instead of silent failures.

## Setup

```bash
npm install
cp .env.example .env          # set DATABASE_URL + super-admin values
npm run db:push               # create/update tables (or: db:generate && db:migrate)
npm run db:backfill           # ONE TIME, only if you already had employees: turns the old free-text
                              # "department" values into real departments and links them
npm run seed                  # create/refresh the platform Super Admin from .env
npm test                      # payroll + timezone unit tests
npm run dev
```

`.env.local` takes precedence over `.env` in both Next.js and the seed script, so keep the
`SUPER_ADMIN_*` values in sync. Re-running `npm run seed` resets the configured super-admin password.

The HTTP bootstrap remains available: `POST /api/auth/seed` with `{"key":"<SUPER_ADMIN_SEED_KEY>"}`.

Deploy to Vercel: add `DATABASE_URL`, `SUPER_ADMIN_*` as environment variables. Any hosted Postgres works
(Neon, Supabase Postgres, RDS…). Companies self-register at `/register`.

> **Stack note:** this codebase uses its own session auth and server-side tenant scoping on Postgres.
> It does **not** use Supabase Auth, Supabase RLS or Supabase Storage. A Supabase *database* can host it
> via `DATABASE_URL`, but isolation is enforced in the API layer (every query is filtered by `company_id`).

## Rules, shifts and salary cycle

* **Cool-off (grace) time:** if an employee's shift starts at 09:00 and the cool-off is 5 minutes, punching in at
  09:04 (or up to 09:05) still counts as a full day. 09:06–(half-day cut-off) is *late*; after the cut-off it is a
  *half day*. Each employee's own shift start is used.
* **Late marks:** every N late days in a cycle can cost extra days of salary (0 = off).
* **Early leave:** leaving up to the early-leave cool-off before shift end is fine; earlier is early leave (optional
  deduction); earlier than the half-day limit counts as a half day (0 = off). Default deduction is 0.
* **Overtime (off by default):** time past shift end beyond a minimum, capped per day, paid at a multiplier of the
  hourly rate (daily rate ÷ shift hours).
* **Salary cycle:** *Rules → Salary cycle*. A cycle is named after the month it ends in (start day 26 → "Nov" is
  26 Oct – 25 Nov). A cycle can only be finalized after its last day. Finalized salaries keep their original dates.
  Changing the start day only affects cycles that are not finalized yet - change it right after finalizing one.
* **Mandatory punch-out:** a day with a punch-in but no punch-out is automatically a **half day** once that day has
  ended (it is not counted as a present day, and the half-day deduction applies). Today is not penalised until the day ends.
* **Leave accrual:** each employee earns **1 leave per month** from their joining month (a November joiner sees 1 leave,
  not 12), capped at *Annual leave days*. Admins choose in **Rules → Leave accrual**: **Carry forward** (the balance
  accumulates) or **Lapse monthly** (the month's leave must be taken that month or it lapses). Leave is requested as
  **Casual** or **Medical** and still needs admin approval.
* Weekly **bi-weekly / weekly** pay cycles are not supported yet (payroll is one record per employee per month cycle).
* Shift times are same-day (punch-out must be later than punch-in); overnight shifts are not supported yet.

## Departments & work locations

* **Company dashboard → Company Setup** shows both with counts and links to manage them
  (also in the sidebar / phone "More" menu: **Departments**, **Locations**).
* **Adding or editing an employee** requires at least one department and at least one work location; an admin can
  pick several of each. Both must be created first.
* **Punching rule:** an employee can punch in/out only inside the radius of one of *their assigned* active
  locations. An employee with **no** assigned location (e.g. created before this feature) can punch at any active
  company location, so existing companies keep working until the admin assigns locations.
* A location that employees are assigned to cannot be deleted (reassign or deactivate it instead), so nobody
  silently gains the right to punch somewhere else.
* Locations replace the old "Geofencing Locations" card in Settings; existing geofences became locations automatically
  (same table).

## Payroll rules (as implemented)

* Daily rate = basic ÷ `work days per month` (company setting).
* **Attendance salary** = basic − (unapproved absent days × daily rate).
* **Late / half-day / approved-leave deductions** = per-day amount (fixed or % of daily rate). Approved leave at
  0 % is paid leave; at 100 % it is unpaid. Nothing is deducted twice.
* **Unapproved leave** = a working day with no punch-in and no approved leave. A run of consecutive
  unapproved working days is **one occurrence** → one hold of `hold days` (default 2) × daily rate.
  Each further occurrence in the month adds another hold. Holds are stored as separate rows, are **not**
  deductions, and an admin can release them.
* **Payable now** = attendance salary − deductions − active holds.
* A month can be finalized only after it ends. Finalized/paid months are frozen; history never changes.
* Weekly offs and company holidays are never counted as absences. "Today" and shift times use the company timezone.

## Operational notes

* Attendance, Photo audit and the dashboard use the **salary cycle** (see *Rules → Salary cycle*), not the calendar month.
* Existing companies default to timezone `UTC` — an admin must set the real timezone in **Settings**
  (new companies get the browser's timezone at sign-up). Late/half-day status depends on it.
* Photos are stored in the database (compressed JPEG ≈ 50 KB) and served only through the authorised
  `/api/attendance/:id/photo` endpoint. For large volumes move them to object storage.
* **Photo retention (45 days):** punch photos are deleted 45 days after their work date; the attendance record, times
  and salary figures are kept. Deletion runs when an admin opens **Photo audit** and from a scheduled job:
  `POST /api/maintenance/purge-photos` with header `Authorization: Bearer $CRON_SECRET`. Set `CRON_SECRET` to a long
  random value and schedule that request once a day (e.g. a Coolify scheduled task). Without it the endpoint refuses to run,
  and photos are still cleared whenever an admin opens Photo audit.
* **Photo audit** (company admin, under *More*): review punch photos by salary cycle, employee and department in a grid
  of large photos, enlarge any photo and download it individually. **Download Excel** exports the attendance data for the
  same filters; **with photos** embeds the punch photos in the sheet (limited to 400 records per export). Download
  anything you need before the 45-day window closes. Every export is recorded in the audit log.
* GPS is validated server-side against the company's geofences, but browser GPS can be spoofed on rooted
  devices; the photo + audit trail are the second line of defence.
* Self-service password change is available on **Profile**; admins can also reset any employee password from
  **Employees**. E-mail-based "forgot password" and push notifications are not wired up yet.
* Hosting on Vercel / serverless: use your Postgres provider's **pooled** connection string (Supabase "Transaction
  pooler", Neon pooled URL) in `DATABASE_URL`, and keep `DB_POOL_MAX` small. Also set `CRON_SECRET` (see Photo retention above).
* Never commit `.env` / `.env.local` (they are in `.gitignore`); `.env.example` must only contain placeholders.
* Still to add for a native app store build: subscription-expiry enforcement/billing, an offline punch queue,
  and a native wrapper (Capacitor/React Native) that reuses these APIs. The PWA already installs standalone on
  Android/desktop and includes an offline fallback page.


## Turning this into a mobile app (Android / iOS)

The web app is already an installable PWA. For store builds the simplest path is a Capacitor shell that loads the
deployed site, so the web app and the mobile app share one codebase and one set of APIs:

```bash
npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap init "TimeTrack" com.yourcompany.timetrack --web-dir=public
# capacitor.config.ts: server: { url: "https://YOUR-DEPLOYED-SITE", cleartext: false }
npx cap add android && npx cap add ios
npx cap sync && npx cap open android      # or: npx cap open ios
```

* Use `@capacitor/camera` and `@capacitor/geolocation` for punching in the native shell (add the camera/location
  permission strings the stores require); the current web `capture`/`navigator.geolocation` flow works in the PWA.
* Authentication is a same-site session cookie, which works when the shell loads your own HTTPS domain. If you later
  want a fully offline/bundled app, switch the APIs to token auth first.
* Store review needs a privacy policy that mentions photo + GPS collection.

## Roles, managers and permissions

* **Company admin** runs the company: employees, managers, departments, locations, rules, salary, reports and all
  attendance. Admins do not punch in or request leave; they are not counted as employees.
* **Manager** is created by the admin on the **Managers** page. Each manager gets one or more **departments** and
  **work locations** (one department can have several managers). Their team is the employees in those departments;
  if the manager has locations, the team is limited to employees with no location or one of the manager's locations.
  The admin switches on the powers each manager needs:
  * *Approve or reject leave* (Level 1 when two approval levels are on; the admin still gives the final approval)
  * *Edit and remove attendance* (every change and removal is written to the audit log)
  * *Add and edit team members* (within their own departments and locations; salary, password and login status stay with admins)
  * *View punch photos* (Photo audit, team only)
  * *View and export reports* (team only)
  * *View team salary* (read only; only admins calculate, finalise or pay)
* **Employee** punches in and out, requests leave and sees their own salary.

Every rule above is enforced by the API (`src/lib/access.ts`); the menus only reflect it.

Run `migrations/2026-11-managers-and-access.sql` once. It moves existing managers to the new model: their own and their
reports' departments and locations are copied across, and they keep the powers they had before (approve leave,
view photos and reports). Review the Managers page after migrating.

## Dashboard

The home screen is served by one endpoint, `/api/dashboard`, scoped to what the viewer may see. It shows today's
presence (present, clocked in now, absent, on leave, late, half day, pending approvals), the salary cycle so far
(late marks, half days, absent and leave days, counted the same way as payroll), pending approvals with names, and
for admins the setup gaps (employees without a department or location, managers without a department).
Salary totals are on the Salary page.


## Salary (admin)

* **Overview** for any salary cycle or custom date range, with filters for department, location and employee.
  * *Total payable (gross)*: the basic salaries of the people shown.
  * *Total deductions*: absent days, late arrivals, half days, unpaid leave, early leave and other deductions.
  * *Net payable balance*: what is left to disburse after deductions, additions, overtime, extra pay and holds.
  * The overview also shows a reconciliation line, so the figures can be checked by hand.
* **Table**: sort by any column; search by name or code. Click a row to open that employee's payslip.
* **Needs attention**: 3 or more leave days in the cycle, or late marks at the company limit.
* **Excel download**: choose Company-wide, Location-wise, Department-wise or Employee-wise. Employee-wise gives one
  sheet per person with a day-by-day breakdown. Optional photos add each employee's latest punch-in photo for the
  period (up to 300 employees). Every export is recorded in the audit log.

Salary figures are calculated in one bulk pass per request (one query per table), not one query per employee.
