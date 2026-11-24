# Dotinout mobile app

A native Android and iOS app (React Native with Expo). It replaces the earlier Capacitor shell and the Flutter
project. It calls the same `/api` routes as the website, so there is one backend.

## Run it

```bash
cd mobile
npm install
npx expo install --check     # aligns package versions with Expo SDK 54
npm run typecheck
npm test
npm start                    # then open in Expo Go or a simulator
```

The app talks to `https://timetrackpro-ai.vercel.app` by default. To point a build elsewhere, set
`EXPO_PUBLIC_API_BASE_URL` in `eas.json` for that profile.

## Build for testing

Builds run on Expo's servers (EAS). Install the EAS CLI once (`npm i -g eas-cli`), then:

```bash
eas login
eas build --platform android --profile preview      # installable APK
eas build --platform ios --profile simulator        # simulator build, no Apple account needed
eas build --platform ios --profile preview          # device build, needs an Apple Developer account
```

The GitHub Actions workflow `.github/workflows/mobile-build.yml` does the same from the Actions tab (see
`.github/SECRETS.md` for the one secret it needs).

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
