# Dotinout: changes in this update

## 0. Required actions before you build (please read first)

1. **Rotate these credentials.** The previous `.env`, `.env.local` and `.env.example` contained live values:
   a Razorpay live key ID and secret, Razorpay test keys, a ZeptoMail token, the super-admin password and a seed key.
   Anything that was in that zip should be treated as exposed. Rotate them in Razorpay, ZeptoMail and your
   database, and change the super-admin password.
2. **Restore your own values** in `.env` (copy from `.env.example`). The delivered `.env` has blank secret values.
3. **Clear the stale build cache** and reinstall: `rm -rf .next && npm install && npm run build`.
4. **Run the database migration** once: `psql "$DATABASE_URL" -f migrations/2027-01-offline-sync-and-indexes.sql`
5. Sync the native projects: `npm run cap:sync`.

## 1. Build and Capacitor

- **`ic` type error.** Nothing in `src/` references `ic`, and the profile route is correct. The error came from a
  stale generated file in `.next/dev/types/`. `tsconfig.json` no longer includes `.next/dev` types, and the
  generated `tsconfig.tsbuildinfo` was removed. Clearing `.next` (step 3) removes the stale file.
- **`npx cap add android` / ENOENT.** `webDir` now points at `mobile-www/`, which has an `index.html`.
- **`capacitor.config.ts`.** The native apps load the hosted app via `CAPACITOR_SERVER_URL` (https only in production).
  `@capacitor/ios` was added to `package.json`, with scripts `cap:sync`, `cap:add:ios`, `mobile:android`, `mobile:ios`.
- **Android.** Camera and location permissions were added (punch-in needed them and they were missing). Test
  sources were in the wrong package and have been moved to `com.dotinout.app`.
- **package-lock.json** does not yet include `@capacitor/ios`. Run `npm install` once to update it, then commit the lock file.

## 2. Specialist routing and dedicated login

- New endpoint `POST /api/auth/specialist/login`. Only Expert Specialist accounts can use it. Every other
  account gets the same generic "invalid" response, so the portal reveals nothing about account types.
- `POST /api/auth/login` (company admins, managers, employees, platform owner) now refuses Specialist accounts
  and points them to the Specialist portal. Previously a `portal` flag on one endpoint decided this.
- Both portals share one sign-in implementation (`src/lib/sign-in.ts`) with separate rate-limit buckets.
- Routing fixes: one helper (`entryPathFor`) decides the landing page for the home page, `/open` (installed app
  entry) and the sign-in redirect. A locked **employee** was previously sent to `/billing` (an admin-only screen);
  only a locked company admin is now sent there.
- Specialist API routes use an explicit role gate (`src/lib/rbac.ts`) in addition to the session check.

## 3. Employee mobile architecture

- Android and iOS shells share the same web codebase (see `MOBILE.md`).
- Safe-area padding on the top header (the bottom navigation already had it).
- Sign-in persists for 400 days across app restarts; sign-out clears this device's cached data.
- Back button: the WebView steps through in-app history; no custom handler is needed.

## 4. Offline caching and sync

- `src/lib/offline/`: a per-device cache for the signed-in profile and the leave list (cleared on sign-out),
  an outbox for queued writes, and an online/offline hook.
- Leave requests made offline are queued and sent automatically on reconnect (and every minute while online).
  Each carries an `Idempotency-Key`, and the server stores the first successful result, so a retry can never
  create a second leave (`idempotency_keys` table, migration above). Requests the server rejects (for example
  dates that are now in the past) are listed in a banner instead of being dropped silently.
- A queued request is only sent by the account that created it. If a shared phone is signed out, the queue stays
  until that same person signs in again.
- Service worker `dotinout-v5`: pages are network-first with a per-user page cache (cleared on sign-out), so the
  last-viewed screens open offline. API responses are never cached by the service worker.
- **Not queued offline, by design:** punch-in and punch-out. They require a live photo and a GPS fix taken at that
  moment, and the server checks their freshness. Queuing them would weaken attendance integrity.

## 5. Security

- Live credentials removed from the delivered `.env`, `.env.local` and `.env.example`. Unused
  `NEXT_PUBLIC_RAZORPAY_KEY_ID` removed. The `SUPER_ADMIN_SEED_KEY` variable was unused and has been removed.
- Client bundles: an audit of `process.env` use shows no server secret is read by a client component. The only
  client-side import from `lib` (`payments-report`) contains pure helpers.
- `next.config.ts`: `productionBrowserSourceMaps` disabled; `/api/*` responses are `no-store`.
- Session tokens are 256-bit random values, stored server-side, revocable and expire after 400 days (unchanged).
- Not changed in this update: a route-by-route permission review of every employee/manager endpoint. The guard
  helper (`requireRoles`) is in place and should be applied to any remaining role-restricted route.

## 6. Performance

- Payslip PDF library loaded on demand (kept out of the salary screen's startup bundle).
- Icons and manifest cached; `compress: true` set explicitly.
- Idempotency-key rows are pruned daily by the existing maintenance job (`/api/maintenance/purge-photos`).
- Migration adds indexes for leave lookups by employee and dates, and for session cleanup.
- Auth still resolves the user, company, settings and employee profile in a single query per request.

## Verification status (honest summary)

- Pure unit tests run and pass (routing, role homes, idempotency-key validation, payroll and others).
- All 213 TypeScript and TSX files parse without syntax errors. `sw.js` and `package.json` are valid.
- **Not run:** `npm run build`, a full `tsc` typecheck, `npx cap sync` and any device test. This environment has no
  network access and no installed `node_modules`, so these must be run on your machine. Please run the steps in section 0.
