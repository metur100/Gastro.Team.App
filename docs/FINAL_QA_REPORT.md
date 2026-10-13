# Final QA report – GastroTeam

Date: 2026-10-13 · Repository: `metur100/Gastro.Team.App` (landing page: `metur100/Gastro.Team.Landing`)

## 1. Features implemented

Authentication (registration, e-mail verification, login with lockout, refresh-token rotation/reuse detection, logout, password reset/change, account deletion), multi-tenant onboarding wizard, dashboard, weekly schedule (employees/roles/day views, drag & drop with rollback, copy day/week, single and weekly publish/unpublish, validation engine, optimistic concurrency), employees (invitations by e-mail and link, deactivation, GDPR export/anonymisation), locations/opening hours/job roles, managers with location scope and permissions, availability, leave with conflict check, shift swaps (targeted/open, approval, exactly-once), in-app notifications + outbox for e-mail/push, reports with safe CSV export, subscription plans and entitlements (test-mode plan changes), platform admin, German UI throughout, native mobile app (Expo) for employees and managers, separate landing page. Not implemented (by plan): time & attendance (phase two), payment provider, MFA.

## 2. Architecture

Modular monolith: ASP.NET Core (.NET 10) API with Domain / Application / Infrastructure / Api layers, EF Core 10 on SQL Server; React SPA on GitHub Pages; Expo app. Details: [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md).

## 3. Database and migrations

One migration `InitialCreate` (32 tables). Applied with the idempotent script to the production database (`__EFMigrationsHistory` = `20261012205303_InitialCreate`). `has-pending-model-changes`: none. Local LocalDB and CI SQL Server 2022 container are created via migrations.

## 4–7. Tests executed / passed / failed / blocked

| Suite | Environment | Result |
|---|---|---|
| Backend unit | local + CI | **69 / 69 passed** |
| Backend integration & security (real SQL Server) | local LocalDB 2025 + CI SQL Server 2022 container | **41 / 41 passed** (total `dotnet test`: 110 passed, 0 failed, ~54 s) |
| Web unit/component (Vitest) | local + CI | **20 / 20 passed** |
| Web E2E (Playwright, desktop + Pixel 7) | local stack (Vite → API → LocalDB) | **7 / 7 passed** |
| Web E2E (Playwright) | **production**: GitHub Pages → runasp.net API → production DB, e-mail verification enforced | **7 / 7 passed** |
| API workflow check (`scripts/api-flow-check.mjs`) | production | **passed** (register, verification enforced, onboarding, invitation, shift, 409 conflict, publish, employee visibility, leave approval, notifications, reports, tenant isolation) |
| API smoke test with demo data | local | passed (33 checks) |
| Mobile (Jest + RN Testing Library) | local + CI | **15 / 15 passed** |
| `expo-doctor` | local | 21 / 21 checks passed |
| GitHub Actions CI (backend, web, mobile jobs) | GitHub | **success** |
| GitHub Pages deployments (app, landing) | GitHub | **success** |

Failed: none at the time of this report. Defects found by the tests and fixed during the work: onboarding hang after creating a business (query cache cleared under mounted queries), stale access token blocking login, stale cached location list, availability "unavailable-only" patterns flagged as unavailable everywhere, refresh de-duplication edge case, accepting an already closed swap, invitation acceptance returning the refresh token in the body for browsers, invalid CI workflow, Pages environment branch policy.

Blocked / not executed: native app on physical devices or emulators (no device/emulator automation available; only typecheck, unit tests and JS bundle export); store builds (no EAS/Apple/Google accounts or signing credentials); push notifications end-to-end (requires EAS project id and push credentials); real delivery of verification/invitation e-mails through the application to an external inbox (SMTP login and one test message to the sender mailbox were verified; automated test accounts use reserved domains that are never mailed).

## 8. Build results

Backend `dotnet build` (Release in CI) without errors; vulnerable-package check clean. Web `tsc -b` + `vite build` succeed (main chunk 483 kB / 152 kB gzip). Mobile `tsc --noEmit` clean; `expo export` Android (5.6 MB Hermes bytecode) and iOS (5.2 MB) bundles built. Landing `tsc -b` + `vite build` succeed.

## 9. Security checks

Tenant isolation, role/location scope, session revocation, invitation expiry/reuse, own-leave approval, publish permission, concurrent double swap approval, composite-FK cross-tenant rejection, fail-closed query filters, dev endpoints absent in Production (all automated). Production verified: CORS allows only `https://metur100.github.io`, refresh cookie `HttpOnly; Secure; SameSite=None; Partitioned`, HSTS, security headers, rate limiting active (observed 429 during testing). Secret scans of both repositories including full history: no passwords, keys or host account identifiers.

## 10. Responsive and accessibility checks

Screenshots reviewed at 375/390/1440 px (and 768/1024 during development) for dashboard, schedule (grid and mobile agenda), employees, leave, availability, settings and landing page; automated no-horizontal-overflow checks in the mobile E2E spec. Accessibility: semantic landmarks, labelled form controls, Radix dialogs/menus, visible focus, skip link, keyboard drag-and-drop alternative (and edit dialog), status shown by text/icon not colour alone, reduced-motion support. No formal WCAG audit with assistive technology was performed.

## 11. Remaining issues / limitations

- Cross-site cookie: browsers blocking partitioned third-party cookies log users out on reload → move app and API to one registrable domain (see DEPLOYMENT.md).
- GitHub Pages serves deep links with HTTP status 404 (SPA fallback); content renders normally.
- Production contains throwaway E2E tenants (`E2E Bistro …`, `E2E Fremd …`, `E2E API Check …`, users `@e2e.gastroteam.example`); no tenant-deletion tool exists yet. The previously used database (before the switch) is no longer referenced and still holds earlier test data.
- 25 advisory React lint warnings (intentional state resets in dialogs, time-based badges).
- Outbox processor assumes a single API instance; retention jobs not automated; no MFA.
- Legal texts (Impressum, Datenschutz, AGB, DPA) are placeholders; labour-law checks need legal review.

## 12. External services requiring configuration

Payment provider; EAS project + APNs/FCM credentials; custom domain via Cloudflare; platform admin e-mail (`GT_PLATFORM_ADMIN_EMAIL`); optional monitoring. SMTP is configured.

## 13–14. Android / iOS release status

Not built, not submitted. Configuration, assets, EAS profiles and listing texts are prepared ([STORE_RELEASE.md](STORE_RELEASE.md)). Bundle identifier `de.gastroteam.app` is a placeholder.

## 15. Deployment readiness

Test environment live: web `https://metur100.github.io/Gastro.Team.App/`, landing `https://metur100.github.io/Gastro.Team.Landing/`, API `https://gastroteam.runasp.net`. Ready for pilot use with test restaurants; not ready for paying customers until the open items in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) are done.

## 16. Reproducing the verification

```bash
dotnet test backend/GastroTeam.Tests                                     # needs LocalDB or GT_TEST_SQL
cd apps/web && npx tsc -b && npx oxlint src && npx vitest run && npm run build
npx playwright test                                                       # API :5191 + Vite :5300 running
E2E_BASE_URL=https://metur100.github.io/Gastro.Team.App E2E_SQL_SERVER=… E2E_SQL_DB=… E2E_SQL_USER=… E2E_SQL_PASSWORD=… npx playwright test
cd ../mobile && npx tsc --noEmit && npx jest --ci && npx expo-doctor && npx expo export --platform android
E2E_SQL_SERVER=… node scripts/api-flow-check.mjs https://gastroteam.runasp.net
```
