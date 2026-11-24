# Mobile app

The Dotinout employee app is a native Android and iOS app, built with React Native and Expo. It is in `mobile/`.

## What it is

- It is not a web page in a wrapper. Every screen is native UI that reads the same `/api` JSON routes the website uses.
- It signs in with the employee's username and password through `POST /api/mobile/auth/login`. The server returns a
  bearer token, which the app keeps in secure device storage (Keychain / encrypted keystore).
- Each screen keeps its last data on the phone and shows it at once when opened. The app then refreshes it in the
  background. If the phone is offline, the saved data stays on screen with a note showing when it was saved.
- The saved data is scoped per user and cleared on sign-out.
- Tabs: Home, Attendance, Leaves, Salary, More. More opens Notice period, Notifications and Profile.

## What it does not do yet

- Punching in and out. It needs the camera, location and device checks, and is the next release.
- Requesting leave, a notice period, or a salary slip.

## Replaced

- The Capacitor shell (`android/`, `ios/`, `mobile-www/`, `capacitor.config.ts`) and its workflows are removed.
- The Flutter app (`employee_app/`) and its workflow are removed.

## Building

See `mobile/README.md` for commands and `.github/SECRETS.md` for the GitHub and signing setup.

## Before the first store update

- **Keep the same Android keystore** as the current Play Store app. A different key cannot update the listing.
- **Check the Android version code.** `mobile/app.json` sets `versionCode` to 1000. Google Play rejects an upload whose
  version code is not higher than the last one it accepted. If the current app's version code is higher than 1000,
  raise `versionCode` in `app.json`.
- **Check the iOS build number.** `buildNumber` is 1000 in `app.json`. It must be higher than the last build uploaded
  to App Store Connect.
- The bundle ID is still `com.dotinout.app`, so the new build is an update to the existing listing, not a new app.

## Testing checklist

1. Install the APK (Android) or the simulator build (iOS).
2. Sign in with an employee account. Wrong passwords should show the server's message.
3. Home, Attendance, Leaves, Salary, Notice, Notifications and Profile should open with data.
4. Turn off Wi-Fi and mobile data, open the app again: saved data should appear with the offline note.
5. Sign out, then sign in as a different employee: the first employee's data must not appear.
