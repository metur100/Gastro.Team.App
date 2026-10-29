# App Store / Google Play release

**Status (2026-10-29):**

- **Google Play: ready to upload, not yet submitted.** Signed release AAB 1.0.0 (versionCode 1, API `https://gastroteam.runasp.net`) built locally with the upload key (`CN=Medin Turkes, O=Medin Turkes, C=DE`, alias `gastroteam-upload`, SHA-256 `CE:55:D3:26:6E:C2:21:53:80:9A:E0:9A:FB:C7:21:D2:5F:2B:D4:B3:BA:25:A9:E4:BB:D1:BD:6F:D6:EC:B8:EB`). AAB, keystore and password file are stored outside the repository (`C:\Users\TurkesMedin\keystore\`). Icon, feature graphic and phone screenshots: `store-assets/android/`. Every Play Console field: [store-assets/android/GOOGLE-PLAY-CONSOLE.md](../store-assets/android/GOOGLE-PLAY-CONSOLE.md). Build steps: `apps/mobile/README.md` → Release.
- **Review account:** `berkcan@gentlegroup.de`, owner of the demo company "Restaurant Berkcan" (2 locations, 15 employees, 4 weeks of shifts); the owner is also linked to an employee profile, so the employee and the manager screens both have data.
- **Open before publishing:** the privacy policy and imprint on `https://gastro.gentlegroup.de/datenschutz/` and `/impressum/` still show template placeholders; a public account-deletion page is recommended (see the Play checklist).
- **iOS:** not built (needs Apple Developer Program + EAS or Xcode).

## Values to confirm or replace

| Value | Where | Current |
|---|---|---|
| iOS bundle identifier / Android package | `apps/mobile/app.config.ts` (`GT_BUNDLE_ID`) | `com.certidevelopment.gastroteam` (dev/preview: `.development` / `.preview` suffix) |
| EAS project id | env `EAS_PROJECT_ID` (after `npx eas-cli init`) | not set → push registration disabled |
| Associated domain / app links for invitations | `app.config.ts` (`associatedDomains`, Android intent filters) | commented placeholder; custom scheme `gastroteam://` works |
| Privacy policy URL | store listings | `https://gastro.gentlegroup.de/datenschutz/` (page exists, content still a template) |
| Support URL / e-mail | store listings | `https://gastro.gentlegroup.de/`, `certidevelopment@gmail.com` (developer account contact) |
| API URL per profile | `eas.json` | `https://gastroteam.runasp.net` |

## Build & submit

```bash
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest init                       # creates the project, prints projectId → EAS_PROJECT_ID
npx eas-cli@latest credentials                # let EAS manage keystore / certificates (never commit them)
npx eas-cli@latest build --profile preview --platform android   # internal APK for testers
npx eas-cli@latest build --profile production --platform all
npx eas-cli@latest submit --platform ios
npx eas-cli@latest submit --platform android
```

Push: upload an APNs key (iOS) and an FCM V1 service-account JSON (Android) to EAS credentials. The server sends via the Expo push API (no server credentials needed for basic use; an Expo access token can be added later).

## Listing (German)

- **Title:** GastroTeam – Schichtplan
- **Subtitle / short description (≤ 80):** Schichten, Urlaub und Schichttausch für dein Gastro-Team.
- **Keywords (iOS):** Schichtplan, Dienstplan, Gastronomie, Restaurant, Mitarbeiter, Urlaub, Schichttausch, Arbeitszeit, Team, Café
- **Category:** Business (secondary: Productivity)
- **Full description:**

> GastroTeam ist die App für Teams in Restaurants, Cafés, Bars und Bäckereien. Sieh jederzeit, wann du arbeitest, trage deine Verfügbarkeit ein, beantrage Urlaub und tausche Schichten mit Kolleginnen und Kollegen – ohne WhatsApp-Gruppe und Telefonkette.
>
> • Meine Schichten: alle veröffentlichten Schichten mit Uhrzeit, Station und Pause
> • Heute: deine nächste Schicht und geplante Stunden der Woche auf einen Blick
> • Verfügbarkeit: wöchentliche Zeiten und einzelne freie Tage
> • Urlaub & Abwesenheit: Anträge stellen und den Status verfolgen
> • Schichttausch: Schichten gezielt oder allen anbieten, Angebote annehmen
> • Benachrichtigungen bei neuen Plänen, Änderungen und Entscheidungen
> • Für Leitungen: Team heute, Freigaben für Urlaub und Tausch
>
> Die App setzt ein Konto bei GastroTeam voraus. Dein Betrieb lädt dich per Link ein.

- **Feature list for screenshots:** Heute · Meine Schichten · Schichtdetail mit Tausch · Verfügbarkeit · Anfragen/Freigaben · Benachrichtigungen
- **Screenshots required:** iPhone 6.9" (1320×2868) and 6.5" (1284×2778), iPad only if `supportsTablet` is enabled (currently disabled); Android phone (min. 1080 px short side), 2–8 per device type; feature graphic 1024×500 for Google Play. Use the demo tenant, never real data.
- **Icon:** 1024×1024 PNG without transparency (generated: `assets/icon.png`); Android adaptive icon foreground `assets/adaptive-icon.png` on `#0c6358`.

## Data safety (Google Play) / App Privacy (Apple) – checklist

| Data | Collected | Purpose | Linked to user | Notes |
|---|---|---|---|---|
| Name, e-mail | yes | account, app functionality | yes | |
| Phone number | optional | app functionality (employer contact data) | yes | entered by employer/employee |
| Employment info (shifts, hours, leave, availability) | yes | app functionality | yes | "Other info" / "Work info" |
| Device push token | yes | notifications | yes | |
| Location, contacts, photos, health, financial data | **no** | – | – | location permissions are blocked in the manifest |
| Analytics / advertising / tracking | **no** | – | – | no SDKs; `NSPrivacyTracking` false |

- Data is encrypted in transit (HTTPS). Deletion: in-app **"Konto löschen"** (Profil → Konto löschen) – satisfies Apple 5.1.1(v) and Google's account deletion requirement; also provide a web deletion URL (web app → Profil & Datenschutz).
- Sick-leave notes: advise users not to enter diagnoses (shown in the UI).
- Export compliance: `ITSAppUsesNonExemptEncryption: false` (only standard HTTPS).

## Review test account

Demo tenant "Restaurant Berkcan" on production (fictional data only): owner login `berkcan@gentlegroup.de` (password in GentleHub → GastroTeam → Testfirma-Login), linked to an employee profile; 14 employee logins on `@example.com` (password in GentleHub → Demo-Mitarbeiter-Login, no mail is sent to those addresses). Details: [store-assets/android/GOOGLE-PLAY-CONSOLE.md](../store-assets/android/GOOGLE-PLAY-CONSOLE.md).
