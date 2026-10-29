# GastroTeam Mobile (Expo / React Native)

Native app for employees and managers. Uses the same REST API as the web app — no WebView.

| | |
|---|---|
| SDK | Expo 57, React Native 0.86, Expo Router (file-based routes in `src/app`) |
| State | TanStack Query, react-hook-form/zod (login), plain validation for compact forms |
| Auth | Access token in memory; refresh token in `expo-secure-store` (Keychain / Android Keystore); rotating refresh with `X-Client: mobile` |
| Push | `expo-notifications`; device token registered via `POST /api/v1/me/push-devices`, server sends via Expo Push |
| Deep links | `gastroteam://einladung/<token>` opens the invitation screen |

## Screens

Tabs: **Heute** (next shift, weekly planned hours, team today for managers), **Schichten** (published shifts, detail with swap request), **Verfügbarkeit** (weekly pattern, single unavailable days), **Anfragen** (leave requests, shift swaps, manager approvals), **Profil** (tenant switch, notifications, push, logout, account deletion). Plus login, password reset request, invitation acceptance, notifications list and new leave request.

## Run locally

```bash
npm ci
# API: production default is https://gastroteam.runasp.net
EXPO_PUBLIC_API_URL=http://10.0.2.2:5191 npx expo start     # Android emulator → local API
EXPO_PUBLIC_API_URL=http://<LAN-IP>:5191 npx expo start     # physical device on the same network
```

Expo Go works for everything except remote push notifications on Android (SDK 53+). For push, create a development build: `npx eas-cli@latest build --profile development`.

## Quality checks

```bash
npx tsc --noEmit        # typecheck
npx jest --ci           # unit/component tests (15)
npx expo-doctor         # dependency/config check
npx expo export --platform android   # proves the production JS bundle builds
```

## Release

Identifiers: `com.certidevelopment.gastroteam` (iOS bundle id / Android package, `GT_BUNDLE_ID` in `app.config.ts`);
the `development` and `preview` variants get a `.development` / `.preview` suffix so they install side by side.

### Local signed Android App Bundle (Google Play upload key outside the repository)

`plugins/withAndroidReleaseSigning.js` adds a `release` signing config that reads `GASTROTEAM_UPLOAD_STORE_FILE`,
`GASTROTEAM_UPLOAD_STORE_PASSWORD`, `GASTROTEAM_UPLOAD_KEY_ALIAS` (`gastroteam-upload`) and `GASTROTEAM_UPLOAD_KEY_PASSWORD`
from Gradle properties (`%USERPROFILE%.gradlegradle.properties`) or environment variables. Without them release builds
fall back to the debug key (never upload those). `plugins/withLocalCmakeDir.js` writes `cmake.dir` from `ANDROID_CMAKE_DIR`
(Windows: CMake ≥ 3.30 avoids the 260-character path limit of the SDK's default CMake 3.22).

```bash
export APP_VARIANT=production EXPO_PUBLIC_API_URL=https://gastroteam.runasp.net
export ANDROID_CMAKE_DIR="$ANDROID_HOME/cmake/3.31.6"
npx expo prebuild --platform android --clean --no-install
cd android && ./gradlew bundleRelease          # add --max-workers=2 on low memory
# → android/app/build/outputs/bundle/release/app-release.aab
keytool -printcert -jarfile app/build/outputs/bundle/release/app-release.aab   # must show CN=Medin Turkes
```

Bump `version` / `android.versionCode` in `app.config.ts` for every upload. Google Play listing checklist:
`store-assets/android/GOOGLE-PLAY-CONSOLE.md`.

### EAS (alternative, iOS)

1. `npx eas-cli@latest init` → set `EAS_PROJECT_ID` (used by `app.config.ts` and push registration).
2. Configure push credentials (APNs key, FCM V1 service account) in EAS — never commit them.
3. `npx eas-cli@latest build --profile production --platform ios`, then `eas submit`.
4. Store listing texts and checklists: `docs/STORE_RELEASE.md`.

Assets are generated with `node scripts/generate-assets.mjs` (no external tools).
