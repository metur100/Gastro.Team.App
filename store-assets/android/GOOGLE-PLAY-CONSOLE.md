# Google Play Console – GastroTeam 1.0.0 (copy & paste checklist)

Status 2026-10-29: everything below is prepared; nothing has been uploaded yet. Fields marked **⚠ before publishing** need the
operator's input. Related: [docs/STORE_RELEASE.md](../../docs/STORE_RELEASE.md), `apps/mobile/README.md` → Release.

## 0. Files

| What | Path |
|---|---|
| Signed release bundle (upload this) | `C:\Users\TurkesMedin\keystore\gastroteam\gastroteam-1.0.0-1-release.aab` (version 1.0.0, versionCode 1, API `https://gastroteam.runasp.net`) |
| Upload keystore (never commit, back up twice) | `C:\Users\TurkesMedin\keystore\gastroteam\gastroteam-upload.jks` (PKCS12, alias `gastroteam-upload`, RSA 4096, valid until 2056) |
| Keystore / key password | `C:\Users\TurkesMedin\keystore\gastroteam-password.txt` (store and key password are identical) |
| Upload certificate | `CN=Medin Turkes, O=Medin Turkes, C=DE` · SHA-256 `CE:55:D3:26:6E:C2:21:53:80:9A:E0:9A:FB:C7:21:D2:5F:2B:D4:B3:BA:25:A9:E4:BB:D1:BD:6F:D6:EC:B8:EB` |
| App icon 512×512 (32-bit PNG) | `store-assets/android/icon-512.png` |
| Feature graphic 1024×500 (24-bit PNG, no alpha) | `store-assets/android/feature-graphic-1024x500.png` |
| Phone screenshots 1080×1920 (JPEG, opaque) | `store-assets/android/phone-screenshots/phone-01-…jpg` … `phone-08-…jpg` (upload in this order) |
| Tablet screenshots | not needed – `supportsTablet: false`, phone-only app |
| Regenerate graphics | `scripts/store-assets.mjs` (see header comment) |

Verify the signer before every upload: `keytool -printcert -jarfile <aab>` → must show `CN=Medin Turkes` and the SHA-256 above.

## 1. Create app

| Field | Value |
|---|---|
| App name | `GastroTeam – Schichtplan` |
| Default language | German (Germany) – de-DE |
| App or game | App |
| Free or paid | Free |
| Declarations | ✔ Developer Program Policies ✔ US export laws |
| Package name (fixed by the first upload) | `com.certidevelopment.gastroteam` |

## 2. Store listing – German (de-DE, primary)

**App name (≤ 30):**
```
GastroTeam – Schichtplan
```

**Short description (≤ 80):**
```
Schichten, Urlaub und Schichttausch für dein Gastro-Team – ohne WhatsApp-Chaos.
```

**Full description (≤ 4000):**
```
GastroTeam ist die Schichtplan-App für Teams in Restaurants, Cafés, Bars, Hotels und Bäckereien. Sieh jederzeit, wann du arbeitest, trage deine Verfügbarkeit ein, beantrage Urlaub und tausche Schichten mit Kolleginnen und Kollegen – ohne WhatsApp-Gruppe, Zettel am Kühlschrank und Telefonkette.

FÜR MITARBEITENDE
• Heute: deine nächste Schicht, Station, Pause und die geplanten Stunden der Woche auf einen Blick
• Meine Schichten: alle veröffentlichten Schichten der kommenden Wochen, nach Tagen sortiert
• Schichttausch: Schicht gezielt einer Kollegin oder allen anbieten, Angebote annehmen oder ablehnen
• Verfügbarkeit: wöchentliche Zeiten, Wunschzeiten und einzelne freie Tage eintragen
• Urlaub & Abwesenheit: Urlaub, Fortbildung oder Krankmeldung beantragen und den Status verfolgen
• Benachrichtigungen bei neuen Plänen, Änderungen und Entscheidungen

FÜR SCHICHTLEITUNG UND INHABER
• Team heute: wer arbeitet heute an welchem Standort
• Freigaben: Urlaubsanträge und Schichttausch mit einem Tipp genehmigen oder ablehnen
• Mehrere Standorte, Rollen und Öffnungszeiten – Planung und Auswertung in der Web-App

DATENSCHUTZ
• Verschlüsselte Übertragung (HTTPS)
• Keine Werbung, kein Tracking, keine Analyse-SDKs
• Konto jederzeit in der App löschen (Profil → Konto löschen)

Die App setzt ein Konto bei GastroTeam voraus. Betriebe registrieren sich kostenlos unter gastro.gentlegroup.de, Mitarbeitende werden von ihrem Betrieb per Link eingeladen.
```

## 3. Store listing – English (en-US, add as translation)

**App name:**
```
GastroTeam – Shift Planner
```

**Short description:**
```
Shifts, time off and shift swaps for your restaurant team – no group-chat chaos.
```

**Full description:**
```
GastroTeam is the shift planning app for teams in restaurants, cafés, bars, hotels and bakeries. See when you work, set your availability, request time off and swap shifts with colleagues – no group chat, no paper schedule on the fridge, no phone chain.

FOR EMPLOYEES
• Today: your next shift, station, break and planned hours of the week at a glance
• My shifts: all published shifts of the coming weeks, grouped by day
• Shift swap: offer a shift to a specific colleague or to everyone, accept or decline offers
• Availability: weekly times, preferred times and single days off
• Time off: request vacation, training or sick leave and follow the status
• Notifications for new schedules, changes and decisions

FOR SHIFT LEADS AND OWNERS
• Team today: who works at which location today
• Approvals: approve or decline time-off requests and shift swaps with one tap
• Multiple locations, roles and opening hours – planning and reports in the web app

PRIVACY
• Encrypted transfer (HTTPS)
• No ads, no tracking, no analytics SDKs
• Delete your account in the app at any time (Profile → Delete account)

The app requires a GastroTeam account. Businesses sign up for free at gastro.gentlegroup.de; employees are invited by their business via link. The app is in German.
```

## 4. Graphics (Store listing → Graphics)

| Field | File |
|---|---|
| App icon | `icon-512.png` |
| Feature graphic | `feature-graphic-1024x500.png` |
| Phone screenshots (8) | `phone-screenshots/phone-01-heute.jpg`, `phone-02-schichten.jpg`, `phone-03-schicht-detail.jpg`, `phone-04-tausch.jpg`, `phone-05-verfuegbarkeit.jpg`, `phone-06-anfragen.jpg`, `phone-07-freigaben.jpg`, `phone-08-benachrichtigungen.jpg` |
| 7" / 10" tablet, Chromebook, Wear, TV | leave empty |
| Video | leave empty |

Screenshots show the real release build (Android emulator, signed in as the review account) with fictional demo data.
Use the same screenshots for the English listing.

## 5. Store settings

| Field | Value |
|---|---|
| App category | **Business** |
| Tags | Business, Productivity / Scheduling (choose up to 5 offered: "Business", "Productivity", "Calendar") |
| Contact e-mail | `certidevelopment@gmail.com` |
| Contact phone | leave empty |
| Website | `https://gastro.gentlegroup.de/` |
| External marketing | ✔ allowed |

## 6. App content (Policy → App content)

### Privacy policy
```
https://gastro.gentlegroup.de/datenschutz/
```
**⚠ before publishing:** the page exists but still shows the template placeholder ("Platzhalter … muss vor der
Veröffentlichung ersetzt werden"); the imprint `https://gastro.gentlegroup.de/impressum/` likewise. Fill both in the
`GastroTeam.Landing` repository (`src/legal.tsx`, `src/config.ts` → `CONTACT_EMAIL`) and redeploy the landing page before
sending the app for review. The policy must name the operator, the processed data (account, employee and scheduling
data, push tokens), the hosting (MonsterASP.NET / runasp.net, SQL Server), the e-mail provider and the deletion process.

### App access
- ◉ **All or some functionality is restricted** → *Add instructions*

| Field | Value |
|---|---|
| Name | `Demo-Betrieb (Inhaber + Mitarbeiterprofil)` |
| Username | `berkcan@gentlegroup.de` |
| Password | (see GentleHub → project → Testfirma-Login) |
| Any other information | see below |

```
Login with the credentials above on the first screen ("Anmelden"). No 2-step verification, no location or device restrictions.
The account owns the demo company "Restaurant Berkcan" (2 locations, 15 fictional employees, published shift plans for the previous, current and next week, a draft week, leave requests and shift swap offers) and is also linked to an employee profile, so all tabs show data:
- Heute: next shift + team today
- Schichten: own published shifts → tap a shift for details and "Schicht tauschen"
- Verfügbarkeit: weekly availability + exceptions
- Anfragen: own leave requests, swap offers, and "Freigaben" (approve/decline leave and swaps)
- Profil → Alle Benachrichtigungen: notifications
Accounts are created by businesses on the web (https://gastro-app.gentlegroup.de); employees join by invitation link. All data is fictional.
```

Keep this account and its data intact while the app is in review/production. If the reviewer approves/declines items,
re-run the seeding scripts or create new requests via the API.

### Ads
◉ **No, my app does not contain ads.**

### Content rating (IARC questionnaire)
| Question | Answer |
|---|---|
| E-mail for rating | `certidevelopment@gmail.com` |
| Category | **All other app types** (Utility, Productivity, Communication or other) |
| Violence / blood / sexual content / nudity / profanity / drugs / alcohol / tobacco / gambling / horror | **No** to all |
| Does the app allow users to interact or exchange content? | **Yes** – users of the same business see colleagues' names and shifts and can send shift-swap requests with a short message. No public chat, no communication with strangers |
| Can users share their location? | **No** |
| Does the app allow purchasing digital goods? | **No** |
| Does the app contain/promote gambling, NFTs, cryptocurrency? | **No** |
| Is the app a web browser or search engine? | **No** |
| Is the app primarily a news / educational app? | **No** |
| Expected rating | USK 0 / PEGI 3 / Everyone (with "Users interact" descriptor) |

### Target audience and content
| Question | Answer |
|---|---|
| Target age groups | **18 and over** (16–17 optional if student workers should be covered – then no extra requirements, app is not designed for children) |
| Could the app unintentionally appeal to children? | **No** |
| Store listing unintentionally appeals to children? | **No** |

### News app
◉ **No**

### COVID-19 contact tracing / status
◉ **My app is not a publicly available COVID-19 contact tracing or status app**

### Data safety
Overview answers:

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS only) |
| Do you provide a way for users to request that their data is deleted? | **Yes** – in-app (Profil → Konto löschen) and via the web deletion URL below |
| Independent security review (MASA)? | No |
| UPI / financial features? | No |

Data types – all **collected**, **not shared** with third parties, **not processed ephemerally**, **required** unless noted:

| Category → type | Collected | Optional? | Purposes | Notes |
|---|---|---|---|---|
| Personal info → Name | Yes | Required | App functionality, Account management | first/last name of employee/user |
| Personal info → Email address | Yes | Required | App functionality, Account management | login, invitations |
| Personal info → Phone number | Yes | **Optional** | App functionality | entered by employer/employee |
| Personal info → User IDs | Yes | Required | App functionality, Account management | internal account id |
| Personal info → Other info | Yes | Required | App functionality | employment data: role, contract hours, shifts, availability |
| Health and fitness → Health info | **No** | – | – | sick-leave requests only store dates and type "Krank"; UI asks users not to enter diagnoses. If the operator considers sick-leave dates health data, declare: Health info, optional, App functionality |
| Messages → Other in-app messages | Yes | **Optional** | App functionality | short message on a shift-swap request / leave note |
| Calendar → Calendar events | **No** | – | – | shifts are app data, the device calendar is not accessed |
| App activity → Other actions | **No** | – | – | |
| App info and performance → Crash logs / Diagnostics | **No** | – | – | no crash/analytics SDK |
| Device or other IDs | Yes | Required | App functionality (push notifications) | Expo/FCM push token |
| Location, Financial info, Photos/videos, Audio, Files, Contacts, Web browsing | **No** | – | – | location/camera/microphone permissions are removed from the manifest |

"Shared" = **No** for all types: data goes only to our own backend (service providers acting on our behalf – hosting,
e-mail, Expo/Firebase push – do not count as sharing).

### Account deletion
| Field | Value |
|---|---|
| Delete account URL | `https://gastro-app.gentlegroup.de/profil` (web app → Profil & Datenschutz → Konto löschen; requires login) |
| In-app path | Profil → Konto löschen (password confirmation) |
| Data deleted | name, e-mail, phone, password, push tokens and notifications are deleted/anonymised immediately; shift history of the employer is kept anonymised (statutory record keeping) |

**⚠ recommended:** Google expects a page that explains the deletion without having to log in. Add
`https://gastro.gentlegroup.de/konto-loeschen/` to the landing page (steps above + contact address for deletion requests)
and use that URL instead. Owners who are the sole owner of a business must first close the business via support – mention
this on the page.

### Government apps / Financial features / Health apps
- Government app: **No**
- Financial features: **None of the above**
- Health apps: **My app does not have any health features**

### Advertising ID
◉ **No** – the app does not use the advertising ID (no `AD_ID` permission in the bundle).

### Permissions in the bundle (no declaration form required)
`INTERNET`, `ACCESS_NETWORK_STATE`, `POST_NOTIFICATIONS`, `VIBRATE`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`, `USE_BIOMETRIC`
(secure storage), launcher badge permissions, `SYSTEM_ALERT_WINDOW` (from React Native; consider adding it to
`android.blockedPermissions` in the next versionCode). No location, camera, microphone, contacts, SMS or storage access.

## 7. Release (Testing → Internal testing first, then Production)

1. Setup → **App signing**: keep *Google Play App Signing* (default). Upload key = the certificate above.
2. Internal testing → Create release → upload `gastroteam-1.0.0-1-release.aab`.
3. Release name: `1.0.0 (1)`
4. Release notes:

```
<de-DE>
Erste Version von GastroTeam:
• Heute: nächste Schicht und Team auf einen Blick
• Meine Schichten mit Station, Pause und Details
• Schichttausch mit Kolleginnen und Kollegen
• Verfügbarkeit, Urlaub und Abwesenheiten beantragen
• Freigaben für Schichtleitung und Inhaber
• Benachrichtigungen bei neuen Plänen und Entscheidungen
</de-DE>
<en-US>
First release of GastroTeam:
• Today: next shift and team at a glance
• My shifts with station, break and details
• Shift swaps with colleagues
• Availability, time off and absence requests
• Approvals for shift leads and owners
• Notifications for new schedules and decisions
</en-US>
```

5. Countries/regions: Germany, Austria, Switzerland (extend later).
6. After internal testing works: promote to **Production** (new personal developer accounts must first run a closed test
   with ≥ 12 testers for 14 days).
7. Next uploads: increase `version` and `android.versionCode` in `apps/mobile/app.config.ts`, rebuild, re-verify signer.

## 8. Demo data in the review account (for reference)

Restaurant Berkcan, Köln – locations *Berkcan Altstadt* (Tue–Sun) and *Berkcan Ehrenfeld* (Wed–Sun) with opening hours;
8 roles (Service, Küche, Bar, Schichtleitung, Spüle, Aushilfe, Beikoch, Runner); 15 employees (full-time, part-time,
Minijob) with accounts on `@example.com` (password in GentleHub → Demo-Mitarbeiter-Login, no mail is ever sent to those addresses); published
weeks 19.10., 26.10. and 02.11.2026 and a draft week 09.11.2026; weekly availability and exceptions; leave requests
(pending/approved/declined, vacation/sick/training/unpaid/other); shift-swap offers (open, awaiting approval, completed,
declined); notifications. All names are fictional.
