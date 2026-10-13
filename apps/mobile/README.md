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

## Release (not yet executed — requires accounts and credentials)

1. `npx eas-cli@latest init` → set `EAS_PROJECT_ID` (used by `app.config.ts` and push registration).
2. Confirm or replace the identifiers: `de.gastroteam.app` (iOS bundle id / Android package) in `app.config.ts` (`GT_BUNDLE_ID`).
3. Configure push credentials (APNs key, FCM V1 service account) in EAS — never commit them.
4. `npx eas-cli@latest build --profile production --platform all`, then `eas submit`.
5. Store listing texts and checklists: `docs/STORE_RELEASE.md`.

Assets are generated with `node scripts/generate-assets.mjs` (no external tools).
