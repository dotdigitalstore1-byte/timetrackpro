# Flutter migration: status

| Milestone | State | Notes |
|---|---|---|
| M0: API inventory | Done | `API-INVENTORY.md`, generated from the route files. 27 employee-facing route files. |
| M0: Decisions | Confirmed | Backend kept (Next.js + PostgreSQL). Online-only punches. Queue for non-punch actions. Rules stay on the server. |
| M1: Token sign-in endpoint | Done in code | `POST /api/mobile/auth/login` returns a bearer token. Cookie sessions unchanged. |
| M1: Bearer authentication | Done in code | `Authorization: Bearer <token>` is read in `sessionTokenFromRequest`. Logout revokes it. |
| M1: Flutter project | Written, not compiled | `employee_app/`. Needs `flutter create` for the native folders, then `flutter analyze` and `flutter test`. |
| M1: CI | Written, not run | `.github/workflows/flutter-employee-ci.yml`. |
| M2: Read-only screens | Written, not compiled | Home, Attendance, Leaves, Salary, Notice, Profile, Notifications, More. |
| M2: Offline cache | Written, not compiled | Drift store (plain SQL, no codegen), stale-while-revalidate, per-user keys, cleared on sign-out. |
| M2: Tests | Written, not run | `formatters_test.dart`, `stale_while_revalidate_test.dart`, `models_test.dart`. |

## Server tests
- `tests/mobile-token-auth.test.ts`: 6 tests, passing.
- The full existing suite: 273 tests, passing.

## Not verified
- No Flutter or Dart SDK in the build environment, so the Dart code has not been compiled or run.
- The Flutter CI workflow has not run on GitHub.
- The bearer endpoint has not been called against a running server or database.

## Known limits
- Bearer tokens last 400 days, the same as web sessions, and are not shortened yet. Sign-out and password reset revoke them at once.
- Bearer tokens are not tied to a device. A stolen token works until it is revoked. Device attestation (Play Integrity, App Attest) is M4.

## M2 notes
- Punching is not in M2. It needs the camera, GPS and device checks (M3).
- The offline queue for leave and profile writes is not built yet (M3). M2 has no write actions.
- Models were written from the route handlers. A response shape that differs from the code will fail to parse,
  and the screen shows a "could not read" message instead of crashing. Check this against a live server first.
- Cached data is stored in plain SQLite in the app's private folder. Encrypting it (SQLCipher) is an open item.
- The inventory (`API-INVENTORY.md`) lists 31 employee endpoints. This file earlier said 27. The inventory is the source.
- Pull-to-refresh returns immediately, and the saved copy stays on screen while the refresh runs.
- Not verified: no Flutter or Dart SDK here, so nothing has been compiled, analyzed or run.
