# GitHub setup for the mobile app builds

Add these in the repository: **Settings → Secrets and variables → Actions**.

## 1. Required for the workflow

**Without `EXPO_TOKEN` the build stops with "An Expo user account is required".** Add it first:
1. Sign in at expo.dev, then go to Account settings → Access tokens → Create token.
2. In GitHub: Settings → Secrets and variables → Actions → New repository secret. Name: `EXPO_TOKEN`. Paste the token.
3. Re-run the failed workflow.

Finished files: after a build, open the run in the Actions tab and download the file from the **Artifacts** section
(`dotinout-android-preview-<run>` contains the APK).

| Name | Type | Value |
|---|---|---|
| `EXPO_TOKEN` | Secret | An Expo access token. Create it at expo.dev → Account settings → Access tokens. |

The server address the app calls is set in `mobile/eas.json` (`EXPO_PUBLIC_API_BASE_URL`). It is not a secret, so no
GitHub value is needed for it.

## 2. Signing (done once, inside EAS, not in GitHub)

Expo's build service signs the app, so the keys are stored in EAS, not in GitHub.

- **Android:** the Play Store app is signed with an existing upload key. Upload that same keystore to EAS once, with
  `cd mobile && eas credentials` → Android → production → Keystore → upload. **It must be the same keystore**, or Google
  Play will reject the update. Keep a backup of the keystore file and its passwords somewhere safe.
- **iOS:** the app needs an Apple Developer Program membership and an App Store Connect record for `com.dotinout.app`.
  `eas credentials` (iOS) can import the existing distribution certificate and provisioning profile, or create new ones.
  Device builds (`preview`) and store builds (`production`) need this. The `simulator` profile does not.

## 3. Old secrets and variables to remove

These were used by the Capacitor and Flutter builds and are no longer read by any workflow. Remove them once the new
signing is confirmed in EAS:

- Variables: `CAPACITOR_SERVER_URL`, `API_BASE_URL`, `IOS_BUNDLE_ID`, `IOS_RUNNER`, `IOS_SIGN_IDENTITY`
- Secrets: `API_BASE_URL`, `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEY_PASSWORD`, `IOS_TEAM_ID`, `IOS_CERT_P12_BASE64`, `IOS_CERT_PASSWORD`,
  `IOS_PROVISIONING_PROFILE_BASE64`, `IOS_KEYCHAIN_PASSWORD`

## 4. Running a build

Open **Actions → Mobile app (Expo / EAS) → Run workflow**, choose the platform and profile, and run it. The build
appears in the expo.dev dashboard, and the log shows a link to download the APK or the iOS build.
