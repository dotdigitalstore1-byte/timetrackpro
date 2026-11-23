# Dotinout: technical plan for offline-first data and queue-based scaling

Status: a plan for review. Items 1, 2 and 4 are partly implemented (see `UPDATE-NOTES-OFFLINE-CACHE.md`). Item 3 is not
started. This document describes what is in the code today, the options for the rest, and the trade-offs.

## 1. Where the app is today

- The native apps load the hosted Next.js app over https (`capacitor.config.ts`). Pages are server-rendered, and data
  comes from `/api/*` routes with cookie sessions.
- Offline support already existed: a per-device copy of the profile and leave list (`src/lib/offline/store.ts`), an
  outbox for leave requests with idempotency keys (`outbox.ts`), and a service worker (`public/sw.js`) that keeps the
  last viewed pages.
- Punch-in and punch-out are synchronous. Each one checks a live photo, a fresh GPS fix, a challenge bound to the
  session, and developer-options / mock-location flags on the server (`src/app/api/attendance/route.ts`).
- The database is PostgreSQL through Drizzle, with `pg` pooling. The app has no queue, no worker process and no Redis.

## 2. Offline-first data (items 1 and 2)

Done in this update: cache-first tab screens (Home, Attendance, Leaves, Salary) with background refresh, per-user keys,
launch prefetch, and clear offline messages.

Next steps:
- **Move to a managed cache layer** (TanStack Query with a persister on IndexedDB, or the same hook with IndexedDB storage).
  localStorage is limited to about 5 MB and is synchronous. Attendance history for a year can exceed that.
- **Signals instead of polling.** Today a screen refreshes when it opens, when the connection returns, and on the
  60-second timer on the salary page. Server events (leave approved, salary changed, punch recorded by a manager) should
  push a small "something changed for user X" message, through push notifications (already partly present in
  `notifications.ts`) or a server-sent events channel. The client then refreshes only the affected screen.
- **Conditional reads.** Add `ETag` and `304 Not Modified` to `/api/attendance`, `/api/leaves` and `/api/salary`, so an
  unchanged copy costs almost nothing at launch.
- **Offline punches stay out of scope**, as decided earlier. A punch must prove a live photo and a fresh GPS fix at the
  moment it is taken.

## 3. Queue-based processing for peak punch-in (item 3)

### The problem
At 9:00 AM a large company can send most of its punches within a few minutes. For 1,00,000 employees over 5 minutes that
is about 333 writes a second. Each punch also does a photo upload, a GPS check and a challenge check. The concern is real,
and the answer is a short queue in front of the database, plus cheap checks at the edge.

### Recommended design
1. **Split the punch into two phases.**
   - Phase A, synchronous and cheap (no heavy database write): verify the session, the challenge (a single indexed read
     or a signed token), the GPS fix age and accuracy, the device-security flags, and the rate limit per company and
     per user. Store the photo in object storage, not in the database row. Return `202 Accepted` with a receipt id.
   - Phase B, asynchronous: a worker takes the receipt from the queue, writes the attendance row, applies late and
     half-day rules, and updates the admin dashboard counts.
2. **The client shows "Punch received" at once.** It then polls `GET /api/attendance/receipts/:id` (or receives a push)
   until the status is `recorded` or `rejected`. A rejection shows the reason and is kept in the failed list, as leave
   requests already are.
3. **Idempotency.** The client's `Idempotency-Key` (already used for leaves) is the receipt key, so a retry never creates
   a second punch.
4. **Queue technology.** Two options:
   - **BullMQ on Redis.** Mature, supports retries, delays and concurrency limits. Needs a Redis instance and a long-running
     worker process. Vercel cannot host the worker, so it runs as a separate service (Coolify, Railway, Fly, or a
     container next to the database). This is the usual choice at this scale.
   - **PostgreSQL-backed queue** (a `punch_jobs` table with `FOR UPDATE SKIP LOCKED`). No new infrastructure, and the
     write is transactional with the rest of the data. Throughput is lower, but it is enough for a few hundred writes a
     second with batching. Good for a first release.
   Recommendation: start with the PostgreSQL queue (no new service to run), and move to BullMQ if measured load needs it.
5. **Workers and the admin dashboard.** Workers write in batches (for example 200 rows per transaction). Dashboard counts
   come from a summary table updated by the worker, not by counting rows at request time. This is also needed for the
   admin dashboard to stay quick at scale.
6. **Protect the database.** Connection pool limits per instance, a read replica for reports, and rate limits on
   `/api/attendance` and `/api/attendance/challenge`.

### Trade-offs to decide
- A punch becomes "recorded" a few seconds after the tap, not instantly. The UX must say so honestly, and the rules that
  depend on the time of punch must use the device time captured in phase A, not the time the worker runs.
- Phase A must still reject a stale challenge or GPS fix. Only the write is deferred, not the checks.
- If the queue or worker is down, the app must not lose a punch. Phase A must refuse the request (503) when it cannot
  enqueue, so the client keeps the punch and retries, rather than returning a receipt that will never be processed.

### Load test before launch
Simulate 1 lakh devices punching within 60 seconds against a staging copy of the database. Measure p95 latency at
the punch endpoint, queue depth over time, and time to drain the queue. Set the target: no dropped punches, p95 under
about 1 second for the accept step, and the queue drained within a minute after the peak.

## 4. Launch delay (item 4)

Done in this update: the native splash hides once the server-rendered overlay is on screen, not after hydration.

Still open, and needs a device trace before any further change:
- Time to first byte of the hosted HTML on a mid-range Android phone on a 4G connection.
- Size of the JavaScript needed before the first screen (`next build` output shows per-route sizes).
- Whether the (app) layout's server-side session query delays the first HTML flush.
Options once measured: cache the app shell for the native app (stale-while-revalidate for navigations, with the
per-user page cache already in `sw.js`), or move non-critical client code out of the root layout.

## 5. Order of work

1. Ship the cache-first tabs and early splash hide (this update), and run the device checklist.
2. Add `ETag` to the three employee read routes, and the staff dashboard summary.
3. Add push or event signals for approvals and salary changes.
4. Design the punch receipt flow and the PostgreSQL queue, behind a feature flag per company, and load test it.
5. Move to BullMQ only if the load test shows the database queue is not enough.

## Decisions needed from you
- Is a Redis instance and a separate worker service acceptable for hosting?
- Is "punch recorded a few seconds later" acceptable for employees and for payroll rules?
- Which companies need to be on the new punch path first?
