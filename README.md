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
* **Salary cycle** – calendar month or a custom cycle (e.g. 26th → 25th). Each cycle is paid on the company's **salary date**
  (a day from the 1st to the 28th of the month after the cycle ends, set under Rules); bonuses/allowances and
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
cp .env.example .env          # set DATABASE_URL + SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD
npm run db:push               # create/update tables (or: db:generate && db:migrate)
# existing databases: run migrations/2026-11-agreements-notice-notifications.sql once (idempotent)
npm run db:backfill           # ONE TIME, only if you already had employees: turns the old free-text
                              # "department" values into real departments and links them
npm test                      # payroll + timezone unit tests
npm run dev
```

The platform owner signs in with `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` from `.env.local`
(which takes precedence over `.env`). The owner's account row is created or refreshed automatically on
the next successful login, so changing either value applies immediately — no seed command, bootstrap
endpoint, or manual database update is needed.

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
* **Unapproved leave** = a working day with no punch-in and no approved leave. It is unpaid (one daily rate).
* **Salary hold** (Rules → Salary hold, ON by default). Every unapproved day delays the **disbursement date** by
  `delay per unapproved day` (default 2) days, counted from the salary date. 1 day → 2 days, 2 days → 4 days,
  3 days → 6 days. The salary is **not** reduced; it is paid in full on the later date. Each run of unapproved days is
  a hold row, and an admin can release it, which cancels that run's delay. Switching the rule OFF removes all delays.
* **Net payable** = attendance salary − deductions + additions, overtime and extra pay. The hold does not change it.
* **Day-wise deduction log**: every amount taken off, on the date it applies to, with the reason (late with the punch
  time, half day, early leave, unpaid leave, unapproved absence, Sunday/holiday cut, late marks, manual). It is shown
  to the admin and the employee on the salary page and on the payslip. It is built from the same day classification
  as the totals, so the two always agree. Finalized salaries keep the log they were calculated with.
* A month can be finalized only after it ends. Finalized/paid months are frozen; history never changes.
* Weekly offs and company holidays are never counted as absences. "Today" and shift times use the company timezone.

## Company logo, agreements, notice period & notifications

* **Company logo** (company admin, **Profile** or **Settings**): upload any picture, then crop it. Drag to position,
  zoom, choose square or round. It is shrunk automatically to a small logo (about 150 KB) and shown in the app header
  for everyone in the company and at the top of salary slips. Served from `/api/company/logo` and cached by version.
* **Company agreements** (company admin, **Agreements**): write a rule or agreement and **push** it. Employees see it as a
  full-screen pop-up the next time they open the app and must answer it to punch in.
  - **Accept** counts for today only, so the pop-up returns on the next open.
  - **Accept with "Don't show again"** is permanent for that version and the pop-up stops.
  - **Decline** blocks punching in for the rest of that day. They are asked again the next day.
  - Editing a live agreement pushes a new version, which asks everyone again. Withdraw stops it. Delete is for drafts.
  - Punch-in is refused on the server while an agreement is unanswered or declined today.
* **Notice period** (company admin, **Notice period**; employees, **More → Notice period**):
  - Policy: standard notice (default 30 days), maximum (90), early release on or off, and the module on or off.
  - An employee requests a notice by confirming they sent a formal resignation email, optionally giving a reason, and
    **signing** by typing their full name exactly as on their account. The signature is recorded with the time.
  - The admin approves and sets the exact number of days and the first day. The last working day is calculated.
    Admins can also place an employee on notice directly, mark a notice completed, or cancel it. Everything is audit-logged.
  - Notice days are calendar days. Salary during notice follows the existing salary-hold rule under **Rules**.
* **Notifications** (bell at the top corner: the mobile header, or the sidebar on desktop): agreements, the outcome of your
  own notice, leave and salary-slip requests, and (for admins) requests waiting for a decision. Items are unread until
  you open the centre. This is an in-app feed. It does not send device push notifications.

## Platform administration, admin check-ins & analytics

* **Company management** (platform admin, **Companies**): every company with plan, status, employees and subscription.
  **Manage → Danger zone** deletes a company permanently. You must type the company's exact name. Deletion removes all of
  its data (employees, attendance, salary, leave, notices, agreements, feedback, logo). A record of the deletion (name,
  headcount, plan, date) is kept in `platform_events`, which survives the company's removal.
* **Periodic company-admin check-in** (company admin): about three times per payroll cycle, once for each third of the cycle
  (the cycle follows *Salary cycle start day* in Rules). It opens full-screen:
  - a scrollable awareness message about fair attendance and avoiding unfair deductions;
  - four highlighted questions about the policies the company actually applies;
  - tick-box answers that stay locked until the message has been read to the end, plus a confirmation tick.
  "Answer later" closes it for this visit only; it returns the next time the app opens while the third is still open.
  Answers are stored with the company, cycle and slot, but **no user id**, so they are anonymous at the record level.
  Each answer gets a leniency index from 0 (strict) to 100 (lenient), from the weights set in `src/lib/feedback.ts`.
* **Platform analytics** (platform admin, **Analytics**; 3, 6 or 12 months): companies are shown only as anonymized labels.
  It compares leniency with team stability (share of headcount that started notice), on-time rate, punch coverage and
  feedback engagement. Correlations need at least 5 companies, and group averages need at least 3. They describe
  association, not cause.

Apply `migrations/2026-11-admin-feedback-platform-analytics.sql` once (idempotent).

## Operational notes

* Attendance, Photo audit and the dashboard use the **salary cycle** (see *Rules → Salary cycle*), not the calendar month.
* Existing companies default to timezone `UTC` — an admin must set the real timezone in **Settings**
  (new companies get the browser's timezone at sign-up). Late/half-day status depends on it.
* Photos are stored in the database (compressed JPEG ≈ 50 KB) and served only through the authorised
  `/api/attendance/:id/photo` endpoint. For large volumes move them to object storage.
* **Photo retention (45 days):** punch photos are deleted 45 days after their work date; the attendance row, times and
  salary figures are kept. **Attendance records without photos are kept 90 days**, then deleted (see *Retention* below).
  Deletion runs from a scheduled job: `POST /api/maintenance/purge-photos` with header `Authorization: Bearer $CRON_SECRET`.
  Set `CRON_SECRET` to a long random value. On Vercel the included `vercel.json` schedules the purge once a day (Vercel sends
  the secret itself); elsewhere schedule that request once a day (e.g. a Coolify scheduled task). Without it the
  endpoint refuses to run, and photos are still cleared whenever an admin opens Photo audit.
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
  device push notifications (the bell is in-app only), and a native wrapper (Capacitor/React Native) that reuses these APIs. The PWA already installs standalone on
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
  * *Net payable balance*: what is left to disburse after deductions, additions, overtime and extra pay. Each employee's salary date and disbursement date are listed too.
  * The overview also shows a reconciliation line, so the figures can be checked by hand.
* **Table**: sort by any column; search by name or code. Click a row to open that employee's payslip.
* **Needs attention**: 3 or more leave days in the cycle, or late marks at the company limit.
* **Excel download**: choose Company-wide, Location-wise, Department-wise or Employee-wise. Employee-wise gives one
  sheet per person with a day-by-day breakdown. Optional photos add each employee's latest punch-in photo for the
  period (up to 300 employees). Every export is recorded in the audit log.

Salary figures are calculated in one bulk pass per request (one query per table), not one query per employee.

## Currency and employee codes

* All amounts are in **Indian Rupees (₹)**, shown with Indian digit grouping (₹1,25,000.00). The currency is fixed,
  so there is no currency setting to change.
* Every employee has an **employee code**, unique within the company. Leave it blank when adding someone to have the
  next code assigned (EMP-0001, EMP-0002…); a code you type must not already be in use. Codes are not case-sensitive.
* Search by **name or employee code** everywhere an employee can be picked: a code such as `EMP-0012` finds that
  person, and a number such as `12` also works. Employee codes appear next to names in the attendance table,
  photo audit, leaves, pending approvals and salary.

Run `migrations/2026-11-currency-and-employee-codes.sql` once. It switches stored currency to ₹, gives codes to any
employee who doesn't have one, and renames duplicate codes (keeping the oldest, so `EMP-0003` becomes `EMP-0003-2`).
Check the Employees page afterwards for any renamed codes.


## Release: salary slips, Sunday/holiday cut, retention, anti-spoofing, peak traffic

Run `migrations/2026-11-slips-holiday-deduction-retention.sql` once (it is idempotent). It adds the holiday-cut settings,
the per-cycle holiday figures and the `salary_slip_requests` table. Existing companies see no change in pay until an admin
switches the holiday rule on. Then deploy and schedule the purge job above.

### Salary slips (45 → 90 day access)
* An employee opens **Salary** and taps **Request slip** on any finalized or paid cycle. The admin sees it under
  **Salary slip requests** at the top of the Salary page and taps **Approve** or **Reject** (with an optional reason).
* After approval the employee downloads the payslip as a PDF. It stays downloadable for **90 days from approval**
  (`SLIP_ACCESS_DAYS` in `src/lib/payroll.ts`). After that the API returns 410 and the employee cannot open it. Admins can always open it.
* The slip shows the frozen, finalized figures, produced by the same helper as the salary page (`src/lib/salary-breakdown.ts`),
  so the two always agree. PDFs are built in the browser with the standard PDF fonts, which show "Rs." instead of "₹".

### Sunday / holiday pay cut (Rules → Deductions & absence)
* Off by default. When on, a block of consecutive non-working days (weekly offs and company holidays together) is cut by one
  day's pay if, among the working days directly before and after the block, at least N are unauthorized absences
  (N = 1 or 2, chosen by the admin).
* Unauthorized absence means a passed working day with no punch, no half-day record and no approved leave.
* Any punch on a day in the block cancels the cut. A block is counted once, in the salary cycle where it starts.
* The cut appears on the payslip as "Sunday / holiday pay cut" and is included in total deductions. Finalized months keep the
  figure stored at finalization.
* Data for the days either side of a cycle is loaded (`HOLIDAY_CONTEXT_DAYS = 7`) so a block at a cycle boundary is judged correctly.

### Retention
| Data | Kept for | After that |
|---|---|---|
| Punch photos | 45 days from work date | Image deleted; times, GPS and status kept |
| Attendance records (no photo) | 90 days from work date | Row deleted |
| Attendance for an unfinalized salary cycle | Until that cycle is finalized (checked within the last 13 cycles) | Never deleted early |
| Finalized / paid salary | Forever | Not affected (stored in `salary_records`) |
| Salary slip access | 90 days from approval | Employee download returns 410 |

**Check before enabling the 90-day deletion:** many countries require payroll and attendance registers to be kept for
several years (in India, for example, under the wage and labour laws). Deleting attendance rows after 90 days may conflict
with those obligations. If you need the longer history, raise `RECORD_RETENTION_DAYS` in `src/lib/payroll.ts` or move
attendance rows to an archive table instead of deleting them. The job never deletes data for an unfinalized salary cycle.

### Anti-spoofing (punch in/out)
* **Live camera only.** The photo comes from the in-app camera. There is no file picker. The server accepts only JPEG
  photos produced by the camera's encoder path, and rejects anything else.
* **Signed, short-lived challenge.** Every punch first fetches `/api/attendance/challenge`, an HMAC signed with the
  signed-in session's token and valid for 3 minutes. A stored or replayed punch request fails. This does NOT prove a live
  camera took the photo. It proves the request was made by the signed-in session just now.
* **Fresh GPS.** The browser must return a fix that is at most 60 seconds old (the server refuses readings older than 90
  seconds). Cached positions are not used (`maximumAge: 0`).
* **Mock location.** A web page cannot reliably detect mock-location apps. The server refuses any punch where
  `mockLocation: true` is sent, and records the attempt in the audit log (`punch.blocked`). Punches with an accuracy under
  1 m are accepted but logged (`punch.flagged`) for review.
* **Making mock-location detection real (Android):** build the Capacitor shell (see *Turning this into a mobile app* above)
  and define `window.TimeTrackNative.isMockLocation()` in it. It should return `true` when the Android location object
  reports `isFromMockProvider()`. The web app already sends that flag. Without a native shell, mock GPS can only be
  reduced by these checks, not fully prevented.

### Peak-hour performance (morning punch-in)
* Authentication is one database query per request (it was three round trips).
* A punch takes four database round trips in total (auth, geofences and assignments together, the existing record, the write).
* **Idempotent punches:** a repeated punch-in or punch-out returns success with `duplicate: true` and the saved record,
  so a retry after a timeout never double-punches or shows an error. The write is conditional (`punch_in_time IS NULL`).
* The browser retries only temporary failures (no connection, timeout, 502/503/504) up to three times with jitter. It never
  retries validation errors.
* The database pool sets `statement_timeout` (20 s) and `query_timeout` (25 s), so a stuck query cannot hold a connection.
* Recommended for Vercel/serverless: use the pooled connection string and keep `DB_POOL_MAX` small (see above).

### Photo compression
Every punch photo is 50-100 KB. The camera tries the best setting first (1024 px, quality 0.85) and steps down until the
photo is at most about 75 KB, so most photos land between 50 and 75 KB. If a step would fall below 50 KB while the previous
one was still under 100 KB, the larger photo is kept. The server rejects anything above 100 KB. The camera view shows the
exact photo that is submitted.

Storage maths: photos are stored as base64 text in the database, which is about a third larger than the JPEG. 50 employees
punching twice a day for 45 days is about 3,900 to 4,500 photos, roughly 270 to 340 MB at 50-75 KB per photo (and up to
about 600 MB if every photo were 100 KB). Supabase's free database is 500 MB, so watch the *Database size* graph, and move
photos to object storage if it keeps growing.

### Rules page
Rules are grouped into categories (attendance timing, overtime and weekly-off work, deductions and absence, leave and salary
cycle, records and privacy). Each rule opens from a full-width tap target with **View more**. Phones get a scrollable category
row; desktops get a side index. **Expand all** and **Collapse all** are available on both.

## Release: live dashboard, late-percentage absence, slip branding, mid-cycle slips

Run `migrations/2026-11-live-dashboard-slips-branding.sql` once (idempotent). Then run the tests (`npm test`).

### Live dashboard (admin and manager home)
* **Daily (live)** shows every employee's status for today, computed from the stored punches and the current time. An
  employee who has not punched in is **Absent** once the cool-off has passed, and shows **Not punched yet** inside it.
  A punch-in updates the status as soon as it is saved. The page refreshes every 30 seconds while it is open.
* **7 days**, **30 days** count each day from punches and approved leave (weekly offs and holidays are not counted).
* **Salary cycle** counts exactly as payroll does, so it matches the salary figures.
* Refreshing is a single small request, so the morning punch-in spike does not multiply load.

### Late-percentage auto-absent (Rules → Attendance timing)
Off by default. When on, a punch-in after the set share of the shift (10–100 %, default 50 %) is recorded as **absent**
instead of late or half day. The employee can still punch in and out. Payroll treats such a day as an absence, the same as
a day with no punch. The cut-off time is shown on the Rules page.

### Rules explanations
Every rule and toggle has an **i** button. It explains what the rule does and gives a worked example.

### Salary slips
* **Company profile & logo** (Settings → Company profile): name, legal name, address, phone, email, website, GSTIN/PAN
  and a logo. The logo is resized in the browser to about 240 px and stored separately from the company row, so ordinary
  requests do not load it. These details appear at the top of every slip.
* **Mid-cycle slips** (Rules → Salary slips during a running cycle): off by default. When on, employees can request a slip
  for the cycle that is still running. On approval the figures are frozen as a **provisional** slip (marked Provisional
  in the PDF, with the as-of date). Once the cycle is finalized, the final figures are shown instead.

### Photos and reports
* Punch photos are compressed to 50-100 KB before upload (see *Photo compression*).
* Reports offer **Last 30 days** and **Last 90 days (text records)**, so the 90-day text data can be exported as
  Excel, CSV or PDF. Photos are not included.
