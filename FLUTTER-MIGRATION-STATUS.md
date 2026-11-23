# Flutter migration: status

| Milestone | State | Notes |
|---|---|---|
| M0: API inventory | Done | `API-INVENTORY.md`, generated from the route files. 27 employee-facing route files. |
| M0: Decisions | Confirmed | Backend kept (Next.js + PostgreSQL). Online-only punches. Queue for non-punch actions. Rules stay on the server. |
| M1: Token sign-in endpoint | Done in code | `POST /api/mobile/auth/login` returns a bearer token. Cookie sessions unchanged. |
| M1: Bearer authentication | Done in code | `Authorization: Bearer <token>` is read in `sessionTokenFromRequest`. Logout revokes it. |
| M1: Flutter project | Written, not compiled | `employee_app/`. Needs `flutter create` for the native folders, then `flutter analyze` and `flutter test`. |
| M1: CI | Written, not run | `.github/workflows/flutter-employee-ci.yml`. |

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
