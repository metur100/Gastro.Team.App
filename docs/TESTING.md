# Testing

| Suite | Location | Runner | Needs |
|---|---|---|---|
| Backend unit (58) | `backend/GastroTeam.Tests/Unit` | xUnit | – |
| Backend integration & security (41) | `backend/GastroTeam.Tests/Integration` | xUnit + `WebApplicationFactory` | real SQL Server (LocalDB or `GT_TEST_SQL`) |
| Web unit/component (20) | `apps/web/src/**/*.test.ts(x)` | Vitest + Testing Library (jsdom) | – |
| Web end-to-end (7) | `apps/web/e2e` | Playwright (desktop Chrome + Pixel 7) | running API + web app |
| Mobile (15) | `apps/mobile/__tests__` | Jest (`jest-expo`) + RN Testing Library 14 | – |
| API smoke | `scripts/smoke-test.mjs` | Node | API with demo data |

## Backend

```bash
dotnet test backend/GastroTeam.Tests --filter Category=Unit
dotnet test backend/GastroTeam.Tests --filter Category=Integration
GT_TEST_SQL="Server=localhost,1433;User Id=sa;Password=…;TrustServerCertificate=True" dotnet test backend/GastroTeam.Tests
```

Each integration test class creates its own database `GastroTeam_Test_<guid>` via migrations and drops it afterwards (deterministic cleanup; verify with `SELECT name FROM sys.databases WHERE name LIKE 'GastroTeam_Test_%'`). Integration tests use the in-memory dev mailbox to follow verification/invitation links and never send real e-mail. SQLite/InMemory providers are deliberately not used.

Coverage of the required security list (`SecurityTests`): S01 cross-tenant read, S02 cross-tenant write + forged tenant header, S03 employee privacy, S04 manager location scope, S05 revoked session refresh, S06 expired/used invitations, S07 own-leave approval, S08 publish permission, S09 concurrent double approval of a swap, S10 cross-tenant relationships (API + composite FK at DB level); plus fail-closed query filters, platform admin, sick-note visibility, production hardening (no dev endpoints).

## Web

```bash
cd apps/web
npx tsc -b && npx oxlint src && npx vitest run
# E2E (local): API on :5191 + `npm run dev` on :5300
npx playwright test
# E2E against the deployed site (creates throwaway tenants with @e2e.gastroteam.example addresses)
E2E_BASE_URL=https://metur100.github.io/GastroTeam npx playwright test --project=desktop
```

The E2E suite covers: owner registers (incl. e-mail verification via dev mailbox where enabled) and onboards; location, opening hours and employee creation; first schedule and publication; editing the week in the planner; invitation link → employee account → employee sees only published shifts; leave request → manager approval with conflict check; second tenant cannot open the first tenant's employee; wrong-password error; mobile drawer navigation, agenda view and no horizontal overflow on key pages.

## Mobile

```bash
cd apps/mobile
npx tsc --noEmit && npx jest --ci && npx expo-doctor
npx expo export --platform android   # bundle build check
```

Native modules (SecureStore, notifications, device) are mocked in `jest.setup.ts`. Device testing (Expo Go / development build) is manual and is **not** part of the automated results.

## Manual/visual checks

Screenshots at 375, 390, 768, 1024 and 1440 px were reviewed during development for the main pages (dashboard, schedule grid/agenda, employees, leave, availability, settings, landing page). Automated overflow checks run in the mobile E2E spec.
