# TimeTrack Pro — multi-company attendance & salary SaaS

Next.js 16 (App Router) + TypeScript + Tailwind + PostgreSQL (Drizzle ORM). Installable PWA that works as
a mobile app (Android/desktop install) and a responsive web app.

## Features

* **Attendance** with photo-verified punch in/out, GPS geofencing, late/half-day automation and an audit
  trail for every correction.
* **Leave management** with leave balance, advance-request rules and 1- or 2-level approvals.
* **Payroll** with attendance-based salary, configurable late/half-day/leave deductions, releasable salary
  holds, month finalization and paid history.
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

* Existing companies default to timezone `UTC` — an admin must set the real timezone in **Settings**
  (new companies get the browser's timezone at sign-up). Late/half-day status depends on it.
* Photos are stored in the database (compressed JPEG ≈ 50 KB) and served only through the authorised
  `/api/attendance/:id/photo` endpoint. For large volumes move them to object storage.
* GPS is validated server-side against the company's geofences, but browser GPS can be spoofed on rooted
  devices; the photo + audit trail are the second line of defence.
* Self-service password change is available on **Profile**; admins can also reset any employee password from
  **Employees**. E-mail-based "forgot password" and push notifications are not wired up yet.
* Hosting on Vercel / serverless: use your Postgres provider's **pooled** connection string (Supabase "Transaction
  pooler", Neon pooled URL) in `DATABASE_URL`, and keep `DB_POOL_MAX` small.
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
