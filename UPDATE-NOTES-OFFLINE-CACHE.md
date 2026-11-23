# Dotinout: instant tabs, offline screens and faster launch

This update covers items 1, 2 and 4 of the architecture review. Item 3 (queue-based processing for 1 lakh punches
at once) is planned in `ARCHITECTURE-PLAN.md` and is not implemented here, because it needs infrastructure decisions.

## 1. Instant tab switching (what changed)

- `src/lib/offline/resource.ts` (new): `useCachedResource(key, fetcher)`. Each tab shows its last saved copy at once,
  from memory first and then from the device copy, and refreshes it in the background. A spinner shows only when
  there is no copy at all. The copy refreshes again when the connection returns.
- `src/lib/offline/tabs.ts` (new): one place for the cache keys and request URLs of the employee tabs. The keys include
  the signed-in user's id, so a shared phone never shows one person's data to another.
- Converted to the cached hook: **Home** (employee dashboard), **Attendance**, **Leaves** and the employee **Salary** view.
- The Salary page no longer sets the month from the response, which used to cause a second fetch on every visit. The
  picker shows the server's current cycle until the user changes it.
- Not changed yet: the admin and manager dashboard (`StaffDashboard`), the salary overview, employees, reports and
  other admin screens. They still fetch on open and show a spinner.

## 2. Offline handling

- The existing "You're offline. Showing saved data." banner (`OfflineSync`) is unchanged.
- Offline with a saved copy: the screen opens with it and no error appears.
- Offline with no saved copy: the screen shows a clear message ("No connection, and this screen has not been saved on
  this device yet…") instead of an endless loader.
- Saved copies are cleared on sign-out (`clearOfflineCache` and the new `clearResourceMemory` in `AppShell`).

## 3. Launch: warm cache and earlier splash hide

- `OfflineSync` warms the employee tabs (Attendance, Leaves, Salary, current cycle) about 1.2 s after launch, once the
  device is online. A copy fetched in the last 15 s is not fetched again when its screen opens.
- `src/lib/native-splash.ts` (new) and `src/app/layout.tsx`: in the native app, a small inline script hides the native
  splash once the server-rendered word animation is on screen, instead of waiting for the JavaScript to hydrate. The
  hydration-time hide in `NativeBootstrap` stays as a fallback.
- Not confirmed on a device. The cause of the blue pause could also be the time the remote HTML takes to arrive. Please
  measure it (see the checklist) before deciding on more changes.

## Verification status (honest summary)

- The changed files were parsed with the TypeScript compiler. No syntax errors were found, and no undefined names remain.
- **Not run:** `npm install`, `npm run build`, the full typecheck, `npx cap sync` and any device test. This environment has
  no package registry access. Run these on your machine before release:
  `rm -rf .next && npm install && npm run typecheck && npm run build && npm test`.

## Please check on a device

1. Open the app online, wait 10 seconds, then switch Home → Attendance → Leaves → Salary → Home. Each tab should show
   data at once, with no spinner, and update quietly.
2. Turn on airplane mode, close and reopen the app. Home, Attendance, Leaves and Salary should show the last data.
   A screen never visited before should show the "not saved on this device yet" message, not a spinner.
3. Sign out, then sign in as a different employee on the same phone. The first employee's data must not appear.
4. Cold start: note the time from the logo to the word animation. Compare with the previous build.
5. Punch in and punch out still need a live connection and are not queued offline (unchanged).

## Server load note

Each employee app launch now makes three extra reads (attendance, leaves, salary for the current cycle). For a large
company at the 9:00 AM peak, that adds up. Before wide rollout, add ETag or `304 Not Modified` support to these three
routes, or serve the cycle summary from a short server-side cache (see `ARCHITECTURE-PLAN.md`).
