# Dotinout mobile apps (Android and iOS)

The employee apps are Capacitor shells around the hosted Dotinout web app. The native app loads your
deployed https URL, so server rendering, cookie sessions and all data access stay on the server.

## One-time setup

1. Deploy the web app and note its public https URL (for example `https://app.dotinout.com`).
2. Install dependencies (adds `@capacitor/ios`): `npm install`
3. Set the server URL for the native build (never commit it to a file with secrets):
   - macOS/Linux: `export CAPACITOR_SERVER_URL=https://app.dotinout.com`
   - Windows PowerShell: `$env:CAPACITOR_SERVER_URL="https://app.dotinout.com"`
4. Sync the native projects: `npx cap sync` (or `npm run cap:sync`).

The Android project is already in `android/`. For iOS, on a Mac with Xcode: `npx cap add ios`, then
`npx cap sync ios`.

## Android (Google Play)

- Open with `npm run mobile:android`, or run `cd android && ./gradlew bundleRelease` for the signed bundle.
- Before each Play upload, increase `versionCode` and `versionName` in `android/app/build.gradle`.
- Add a release signing config (keystore kept outside the repository).
- Permissions declared: internet, network state, camera and location (needed for photo-verified punch-in).
- Play Console: provide a privacy policy URL and complete the Data safety form (photos, precise location,
  account data). Explain why camera and location are needed for punch-in.

## iOS (Apple App Store)

- Open with `npm run mobile:ios`, select a team under Signing & Capabilities, then Product > Archive.
- Add these keys to `ios/App/App/Info.plist` (the app crashes on first camera or location use without them):
  - `NSCameraUsageDescription`: "Dotinout uses the camera to take a photo when you punch in and out."
  - `NSLocationWhenInUseUsageDescription`: "Dotinout checks that you are at your work location when you punch in and out."
- App Review expects a native app to offer more than a website. Keep the native-only pieces (camera punch-in,
  location checks, offline leave requests, device-level sign-in persistence) prominent in the review notes.

## Behaviour on the device

- Back button (Android): the WebView steps back through in-app pages; on the home screen it leaves the app.
- Safe areas: the top header and bottom navigation pad for the notch, status bar and home indicator.
- Sessions: the sign-in cookie lasts up to 400 days, so people stay signed in across app restarts. Signing out
  revokes the session on the server and clears this device's cached data.
- Offline: the last viewed pages, profile and leave list are available. Leave requests made offline are saved
  on the device and sent automatically on reconnect, once each, using an idempotency key. Punch-in is not
  queued offline, because it must prove the live photo and a fresh GPS fix at the moment it is taken.

## Local development

- Run the web app: `npm run dev`. To test on an Android emulator, set
  `CAPACITOR_SERVER_URL=http://10.0.2.2:3000` (the emulator's view of your computer). Plain http is only allowed for that value.
