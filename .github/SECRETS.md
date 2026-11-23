# GitHub setup for the Android and iOS builds

Add these in your repository: **Settings → Secrets and variables → Actions**.
Use **Variables** for values that are not sensitive and **Secrets** for everything else.

## 1. Needed for every build (debug and simulator)

| Name | Type | Value |
|---|---|---|
| `CAPACITOR_SERVER_URL` | Variable | Public https address of the deployed web app, for example `https://app.yourdomain.com`. The native app loads this site. |

**Your server `.env` values (DATABASE_URL, Razorpay, ZeptoMail, SUPER_ADMIN_*) are NOT needed here.** The mobile app
does not contain the server code or its secrets. Those variables belong on your web host (Vercel, Coolify, etc.).

## 2. Android release bundle (only for "Run workflow" with "Also build a signed release bundle" ticked)

| Name | Type | Value |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | Secret | Your upload keystore file encoded as base64 (see below). |
| `ANDROID_KEYSTORE_PASSWORD` | Secret | Keystore password. |
| `ANDROID_KEY_ALIAS` | Secret | Key alias inside the keystore. |
| `ANDROID_KEY_PASSWORD` | Secret | Key password. |

Create a keystore once and keep a backup somewhere safe. **If you lose it you cannot update the app on Google Play.**

```bash
keytool -genkeypair -v -keystore dotinout-upload.keystore -alias dotinout \
  -keyalg RSA -keysize 2048 -validity 10000
# Encode for GitHub (macOS: base64 -i ...; Linux: base64 -w0 ...)
base64 -w0 dotinout-upload.keystore > keystore.b64
```
Paste the contents of `keystore.b64` into `ANDROID_KEYSTORE_BASE64`. Delete the local `.keystore` and `.b64` afterwards.

## 3. iOS simulator app

Nothing extra. Optionally add the Variable `IOS_BUNDLE_ID` if your bundle ID is not `com.dotinout.app`.

## 4. iOS signed archive (.ipa) (only for "Run workflow" with "Also build a signed .ipa" ticked)

You need an Apple Developer Program membership ($99/year).

| Name | Type | Value |
|---|---|---|
| `IOS_TEAM_ID` | Secret | 10-character Team ID from developer.apple.com → Membership. |
| `IOS_CERT_P12_BASE64` | Secret | Distribution certificate exported as `.p12`, encoded as base64. |
| `IOS_CERT_PASSWORD` | Secret | Password you set when exporting the `.p12`. |
| `IOS_PROVISIONING_PROFILE_BASE64` | Secret | App Store (or Ad Hoc) provisioning profile for `com.dotinout.app`, base64. |
| `IOS_KEYCHAIN_PASSWORD` | Secret | Any strong random string. Used only for the temporary keychain on the runner. |
| `IOS_SIGN_IDENTITY` | Variable (optional) | `Apple Distribution` (default) or `Apple Development` for development profiles. |
| `IOS_BUNDLE_ID` | Variable (optional) | Defaults to `com.dotinout.app`. |

How to get the files:
1. In Xcode (Settings → Accounts) or developer.apple.com, create an **Apple Distribution** certificate.
2. Export it from Keychain Access as `.p12` (include the private key), then `base64 -w0 cert.p12 > cert.b64`.
3. On developer.apple.com create an App ID `com.dotinout.app` and an **App Store** provisioning profile for it, download the `.mobileprovision`, then `base64 -w0 profile.mobileprovision > profile.b64`.
4. Paste each `.b64` file's content into the matching secret.

Apple also needs an App Store Connect record for the app before a build can be uploaded to TestFlight.

## 5. Running the builds

- **Automatic:** every push to `main` builds the Android debug APK and the iOS simulator app.
- **Manual:** Actions → choose the workflow → Run workflow. Tick the signed options only when you need them.
- **Downloading:** open the run → scroll to **Artifacts**. Artifacts are kept 30 days (signed release files 90 days).
- **Installing the debug APK:** download, unzip if needed, copy to an Android phone, allow installs from that source, and open it.
- **Testing the simulator app:** unzip, drag the `.app` onto a running iOS Simulator (or use `xcrun simctl install booted App.app`).
  A physical iPhone needs the signed `.ipa` (ad-hoc or TestFlight).

## 6. Project files these workflows expect

- `android/` is committed (it is, in this package). The workflow runs `npx cap sync android` on every build.
- `ios/` is created automatically on the runner if it is missing. **For a real signed build, commit your `ios/` folder** so
  your signing settings and capabilities are kept, and the workflow only adds the camera/location text.
- `package-lock.json` must include `@capacitor/ios`. Run `npm install` locally once and commit the lock file.
