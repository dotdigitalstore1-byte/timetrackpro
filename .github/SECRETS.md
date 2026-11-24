# GitHub Actions setup for the Android APK

The Gradle-based Android workflow does **not** require any GitHub secrets or variables. In particular, it does not need `EXPO_TOKEN` and does not use EAS Build.

To build: open **Actions → Dotinout Android APK (Gradle) → Run workflow**. When complete, download the `dotinout-debug-apk` artifact.

The API address is configured as `EXPO_PUBLIC_API_BASE_URL` in `.github/workflows/mobile-build.yml`; it currently points to `https://timetrackpro-ai.vercel.app` and is not a secret.

This workflow creates a debug APK for testing. A Play Store release requires a separately configured Android release signing key. Keep that keystore and its passwords private and backed up; never commit them to the repository.
