# Update notes: privacy manifest, privacy policy, camera fix

## Changed files
- `ios/App/App/PrivacyInfo.xcprivacy` (new): privacy manifest. Declares no tracking, the collected data types (precise location,
  photos, name, email, phone, user ID, financial info; all linked, all for app functionality), and the UserDefaults
  required-reason API (CA92.1). Verify against Xcode's privacy report after the first archive.
- `ios/App/App.xcodeproj/project.pbxproj`: the manifest is registered in the App target's Resources phase so it is bundled.
- `src/app/privacy/page.tsx` (new): public Privacy Policy at `/privacy`. DRAFT: needs counsel review before store submission.
  Section 6 does not promise in-app account deletion, because that feature does not exist yet.
- Privacy Policy links added to: the mobile employee sign-in (`EmployeeLogin.tsx`), the web sign-in (`WorkspaceLogin.tsx`)
  and the employee download page (`AppDownloadView.tsx`). Use `https://<your-domain>/privacy` as the store listing URL.
- `src/components/CameraCapture.tsx`: on Android, after the back camera opens, if the browser picked a telephoto or ultra-wide
  lens, the main back lens is selected by device id. The existing 1x zoom request is unchanged.

## Not verified
- No device test was run. The camera change must be checked on physical Android and iOS phones (the iOS path is unchanged,
  so the iOS zoom issue is not fixed by this change; a native AVFoundation camera plugin may be needed).
- iOS project has not been compiled in Xcode.
