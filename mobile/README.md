# Dotinout mobile app

A native Android and iOS app (React Native with Expo). It replaces the earlier Capacitor shell and the Flutter
project. It calls the same `/api` routes as the website, so there is one backend.

## Run it during development

```bash
cd mobile
npm ci
npx expo install --check
npm run typecheck
npm test
npm start
```

`npm start` is the Expo development server. Expo Go is optional for compatible screens, but it is **not** used to create the installable Android APK described below.

## Build an Android APK for testing (free, local Gradle)

Requirements: Windows/macOS/Linux, Node.js 22, JDK 17, Android Studio and Android SDK.

On Windows, open this folder and run:

```bat
build-apk.bat
```

The script runs Expo Prebuild to generate the native `android` project and then runs Gradle `assembleDebug`. The APK is copied to `mobile/dotinout-debug.apk`.

Detailed Windows setup, installation and troubleshooting: [MOBILE-APK-WINDOWS.md](./MOBILE-APK-WINDOWS.md).

## Build an Android APK on GitHub (no EAS / no Expo token)

The workflow `.github/workflows/mobile-build.yml` runs on pushes to `main` that change `mobile/**`, or manually from GitHub Actions. It uses GitHub-hosted Ubuntu, Node 22, Java 17, Android SDK and Gradle. Download the `dotinout-debug-apk` artifact from the completed run.

GitHub Actions has usage limits; free availability depends on the repository visibility and your GitHub plan. No Expo account, `EXPO_TOKEN`, or EAS build is required.

## API address

The app talks to `https://timetrackpro-ai.vercel.app` by default. To point a build elsewhere, set `EXPO_PUBLIC_API_BASE_URL` before Prebuild/building.

## Layout

- `src/api/` the API client, endpoint functions, response types and error messages.
- `src/storage/` the bearer token (secure storage) and the offline cache (AsyncStorage, per user).
- `src/data/useResource.ts` shows saved data at once, then refreshes it in the background.
- `src/auth/SessionContext.tsx` sign-in, session restore on launch, sign-out.
- `src/navigation/` the tabs (Home, Attendance, Leaves, Salary, More) and the pushed screens.
- `src/screens/` one file per screen.

## Not in this version

- Punching in and out. It needs the camera, location and device checks, and is planned as the next release.
- Requesting leave, a notice period, or a salary slip from the app.

Creating an APK packages the current app; it does not add features that are not implemented yet.
