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

## 7. Employee web/app split, Super Admin app links (latest update)

Run once: `psql "$DATABASE_URL" -f migrations/2027-02-app-downloads.sql`

**Employees on the web**
- Signing in on the web takes an employee to `/get-app`, the download page. The dashboard, attendance and every
  other (app) screen redirect there.
- Employee self-service API routes return 403 to web requests: attendance (read and punch), punch challenge,
  leaves, salary (read, overview, slip requests and downloads), notices, and agreement acceptance.
  Admins, managers and the platform owner are not affected.
- The download page shows Google Play and App Store buttons (visible even without a link, marked "Link not added
  yet") and a direct download button per platform only when that platform has an uploaded file.

**How the app is recognised**
- Capacitor appends `DotinoutNative/1` to the app's user agent (`appendUserAgent` in `capacitor.config.ts`).
  Login, the landing page and every employee route use this token.
- Mobile employees go straight to their home page after login.
- **Limitation:** the token is visible to anyone, so a determined user could copy it in a browser. The web block stops
  normal use of the web app, but it is not a hard security boundary. Punch-ins still require a session-bound challenge,
  a live photo and a fresh GPS fix. Stopping browser-copied tokens completely requires Google Play Integrity and Apple
  App Attest; that is the next step if you need it.

**Super Admin → App links** (sidebar item "App links")
- Save the Play Store and App Store links. Each must use the store's own domain (`play.google.com`,
  `apps.apple.com`, `itunes.apple.com` or `testflight.apple.com`) and start with https.
- Upload the Android package (`.apk`) and the iOS package (`.ipa`), up to 150 MB each. Each file is checked for the
  right extension and a valid package header. Uploading again replaces the file; Remove hides the button.
- Files are stored in the database (`app_downloads` table) and served only to signed-in users.
  **Hosting limit:** on Vercel, request bodies are capped at about 4.5 MB, so large APK/IPA uploads will fail there.
  Use a self-hosted deployment (Coolify etc.) for uploads, or move the files to object storage (for example Vercel Blob)
  before going live. Also check your database storage plan, since each package is stored in full.

**iOS direct install:** an `.ipa` only installs on devices enrolled in your Apple developer account (Ad Hoc or
enterprise distribution). For general employees, use the App Store or TestFlight link. The Super Admin upload is
kept for controlled rollouts.

**Logos:** the store badges in the download page are simplified placeholders. Replace them with the official
"Get it on Google Play" and "Download on the App Store" artwork before launch, as their brand guidelines require.

## 8. Mobile app: employees only, launch animation, session and tap feedback

Run once: `psql "$DATABASE_URL" -f migrations/2027-03-links-and-registration.sql`

**Mobile app scope (enforced on the server, not only in the screens)**
- The mobile app accepts employee accounts only. Company admins, managers, Expert Specialists and the platform owner
  get "The Dotinout mobile app is for employees only…" on every sign-in route, and any existing session is sent to
  `/app-restricted`. Web sign-in for those roles is unchanged.
- The mobile login is a separate screen: Username, Password, and a helper note ("Forgot your password? Contact your
  company admin to reset it."). There is no Forgot password link and no Expert Specialist button in the app.
  The specialist sign-in page redirects to the employee login inside the app.
- "New company? Register your business" opens the URL set in Super Admin → Links (default https://dotinout.com).
- Employees change their own password in Profile, as before.
- Employees on the web still see only the download page (`/get-app`). The mobile app never routes to that page.

**Launch animation (mobile only)**
- The overlay is rendered by the server on the first paint, so the screen is not blank while the app loads.
- Timeline: "Dotinout" appears → o, t, n, u, t fade out → D, I, O slide together and become uppercase → the overlay
  fades into the app (about 2.8 s in total).

**Session persistence and the web screen inside the app**
- Android: `MainActivity` flushes the WebView cookie store when the app goes to the background, so the sign-in
  cookie is written to disk before the app can be swiped away.
- The web-only screen could appear inside the app from an offline page cache. The cache is now `dotinout-pages-v2`
  (old caches are deleted), and the sign-in, entry, download and restricted pages are never cached.
- **iOS is not fixed in this package.** The iOS project is not in the zip. WKWebView cookie persistence needs a native
  change in `ios/App/App/AppDelegate.swift` (flush the cookie store on background), which must be made and tested on a device.
  If sign-outs still happen after restarts, the next step is to keep the session token in secure device storage.

**Speed and feedback**
- Read requests (GET) are retried automatically up to two more times on a dropped connection or timeout. Writes are
  not retried, so a punch or leave is never sent twice.
- Every button and link has a press animation (scale and opacity).
- A progress bar appears at the top as soon as a link is tapped.
- Action buttons already show a spinner while they are busy.

**Known gaps**
- Real-time sync: employee actions are saved to the database immediately, and the admin dashboard shows them on
  the next load or refresh. Instant push updates would need a real-time channel (not built).
- Store approval: Apple guideline 4.2 (minimum functionality) and Google Play's account and data-safety rules
  apply. Provide a privacy policy URL, the data-safety form, and review notes that explain the employee-only app.
  The registration link opens in the device browser, and no in-app purchase exists. Opening external links is
  handled by Capacitor's default navigation rules; add `@capacitor/browser` if testing shows otherwise.
- Store badges are placeholders. Use the official Google Play and App Store artwork.

**Not verified in this package:** no device, emulator, or store test was run. Required device checks: force-close and
reopen (stays signed in), a non-employee sign-in in the app (blocked), the web download screen never appearing in the
app, the launch animation, tap feedback on every button, and admin dashboard sync after punches and leave requests.

## 9. Routing, black screen, session launch (latest update)

**Before building:** run `npm install` (adds `@capacitor/browser` and `@capacitor/splash-screen`, and updates the
lock file), then `npm run cap:sync`.

**Why web screens appeared inside the app**
- The app was recognised only by the user-agent token on each request. On some cold starts the token did not reach
  the server, so the web login and the web-only download screen were rendered.
- Now the app is also recognised by the cookie `dio_native=1`. The first request that carries the token sets it
  (`src/middleware.ts`), and it persists on the device. Every route, sign-in and layout checks both signals.
- The service worker is no longer used by the app. On launch the app unregisters it and clears its caches, so a cached
  page cannot be shown inside the app.
- Note: Next.js 16 may label `middleware.ts` as deprecated in favour of `proxy.ts`. It still works; rename the file when convenient.

**Register Your Business**
- In the app, the link opens in the device browser through the Capacitor Browser plugin. On the web, it is a normal link.
- The Super Admin "Links" page rejects a registration link that points to this app's own host. The login screen also
  falls back to https://dotinout.com if the saved link points to the app.

**Black screen and startup**
- Android: the launch theme uses the Dotinout indigo (#4F46E5) as its window and splash background, so there is no black screen.
- The native splash (`@capacitor/splash-screen`, configured in `capacitor.config.ts`) stays up until the first screen has
  painted, then `NativeBootstrap` hides it. A 6-second safety timer hides it if the first paint is slow.
- The Dotinout → DIO overlay uses the same indigo, which removes the colour flicker before the login screen.

**iOS: not complete in this package.** The `ios/` folder is not in the zip. Before the iOS build:
- Set the LaunchScreen background to #4F46E5 in the iOS project, so the first frame is indigo.
- Add the `AppDelegate` cookie flush on background (see section 8).
- Run `npx cap sync ios`.

**Device QA required before release** (not run in this package): cold start 5+ times with no black screen; logged-out
state shows only the employee sign-in; "Register your business" opens the browser; sign in, force-close and reopen
lands on the Punch In/Out screen; navigation and button feedback are smooth on both platforms.

## 10. iOS project (merged from ios.zip)

The `ios/` folder is now part of the project (Capacitor 8, Swift Package Manager, no CocoaPods, iOS 15+, bundle ID com.dotinout.app).

**Changes made to the iOS project**
- **Launch screen and splash:** replaced Capacitor's default white splash with the Dotinout indigo (#4F46E5) mark and
  wordmark, and set the launch-screen background to the same indigo. Regenerate from the mark in `src/components/Brand.tsx`
  if the brand changes.
- **App icon:** replaced with the Dotinout mark on the indigo-to-violet gradient (1024×1024, no transparency).
- **Window background:** indigo behind the first frame (`SceneDelegate.swift`), so there is no white or black flash.
- **Permissions:** added `NSCameraUsageDescription` and `NSLocationWhenInUseUsageDescription`. Without them, the app
  is terminated the first time the employee punches in.
- **Export compliance:** `ITSAppUsesNonExemptEncryption = false` (no custom encryption; HTTPS only).
- **Device requirement:** `arm64` replaces the outdated `armv7`. Display name is now "Dotinout".
- **Session persistence (best effort):** `sceneDidEnterBackground` asks the WebKit cookie store for its cookies and
  holds a short background task, so the sign-in cookie is written before iOS suspends the app. Apple does not document a
  flush API, so this must be verified on a device (force-close and reopen).
- **User agent:** `capacitor.config.json` now includes `appendUserAgent: DotinoutNative/1`. Without it, iPhone users were
  treated as browsers and shown the web screens. This file is generated by `cap sync`, and `cap sync` writes the server URL
  from `CAPACITOR_SERVER_URL`, so always sync with that variable set.
- **Shared scheme:** `App.xcodeproj/xcshareddata/xcschemes/App.xcscheme` is committed, so CI can build scheme `App`.
- **CI:** the iOS workflow builds `App.xcodeproj` directly. This project has no `.xcworkspace`, so the earlier workspace
  path would fail.

**Not verified:** Swift code was not compiled (the build environment is Linux, without Xcode). The first iOS CI run
will show any compile problems. Run `npx cap sync ios` on a Mac or in CI before you open the project in Xcode.
