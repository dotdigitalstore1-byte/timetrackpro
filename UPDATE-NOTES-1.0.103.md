# Dotinout 1.0.103: changes from the 1.0.102 test report

## 1. Developer Options and mock location (Android)
- `android/app/src/main/java/com/dotinout/app/DeviceSecurity.java` (new): exposes `window.TimeTrackNative`
  with `securityStatus()`, `isDeveloperOptionsEnabled()` and `isMockLocation()`.
- `MainActivity.java` registers the bridge when the app starts.
- The web app (`src/lib/device-security.ts`, `src/components/DeviceSecurityGate.tsx`) locks the whole app with a
  full-screen prompt when Developer Options or a mock-location app is on. It re-checks on launch, when the app returns
  to the foreground, and via "Check again". Punch-in and punch-out also check before the camera opens and again before
  the punch is sent.
- The server (`src/app/api/attendance/route.ts`) refuses any punch that reports Developer Options or mock location.
- iOS: not covered. Apple does not expose Developer Options to apps. Tell us if you want a simulated-location check.

## 2. Startup, black screen and default icons
- Android and iOS launch and launcher icons replaced with the Dotinout mark (`android/.../res`, `ios/.../Assets.xcassets`).
- Android adaptive icon background is now the brand indigo (was white with the default Capacitor grid).
- Brand indigo is set behind the WebView and in the window theme (`capacitor.config.ts`, `values/styles.xml`), so there is
  no black frame between the native splash and the first web page.

## 3. Back camera zoom (punch-in)
- Back camera preview shows the full frame (`object-contain`) instead of cropping a 16:9 feed into the portrait screen.
- The back camera requests the standard 1x lens where the device reports a zoom range.
- The front camera is unchanged.

## 4. Splash animation
- Letters stay in their case: the animation settles into `Dio` (only the D is capital).
- Smoother easing on every letter and on the overlay fade.

## 5. iOS build
- `ios-build.yml` runner label is now `vars.IOS_RUNNER` (default `macos-latest`). Set the repository variable to move
  to another macOS pool if the queue stalls again.

## Test checklist (real device)
1. Turn on Developer Options: the app shows "Attendance is locked" straight away, and punch-in is not possible.
   Turn it off, return to the app, tap "Check again": the app unlocks.
2. Enable a mock-location app as the mock location app: same lock. Disable it: unlocks.
3. Cold start: Dotinout indigo splash, no default Capacitor logo, no black frame.
4. Splash animation ends on `Dio`, with lowercase `i` and `o`.
5. Punch In with the back camera: normal framing, no heavy zoom.
6. Build Android and iOS. Note: the Android build needs `npx cap sync` once so the native config picks up the background colour.
