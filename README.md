# GastroTeam

Schichtplanung und Mitarbeiterverwaltung für Restaurants, Cafés, Bars und Bäckereien — a multi-tenant SaaS replacing WhatsApp groups, spreadsheets and paper schedules.

| Part | Stack | Path |
|---|---|---|
| API | ASP.NET Core (.NET 10), EF Core 10, SQL Server, ASP.NET Core Identity, JWT + rotating refresh tokens | `backend/` |
| Web app | React 19, TypeScript (strict), Vite 8, Tailwind CSS 4, Radix UI, TanStack Query, react-hook-form + zod, dnd-kit | `apps/web/` |
| Mobile app | Expo SDK 57 / React Native 0.86, Expo Router, SecureStore, expo-notifications | `apps/mobile/` |
| Landing page | Separate repository `GastroTeam.Landing` | `../GastroTeam.Landing` |

**Live (test environment):** web app `https://metur100.github.io/GastroTeam/` (after the repository is pushed) · API `https://gastroteam.runasp.net` (`/health`).

## Features

- Registration, e-mail verification, login with lockout, password reset, session rotation and revocation, account deletion
- Onboarding wizard (business → location → opening hours → team → first schedule → done) with saved progress
- Dashboard with live KPIs, today's timeline and action items
- Weekly schedule (employees / roles / day agenda), drag & drop with optimistic update and rollback, keyboard-accessible, copy day/week, publish/unpublish with validation (errors block, warnings need confirmation), optimistic concurrency
- Schedule rules: overlaps, rest periods, breaks, daily/weekly limits, contract hours, availability, leave, opening hours, minimum coverage — configurable, documented as non-legal-advice
- Employees (search/filter/sort/paging, invitations by e-mail or shareable link, deactivation, GDPR export/anonymisation), locations, job roles, managers with location scope and fine-grained permissions
- Availability, leave requests with conflict check, shift swaps (targeted or open offers, manager approval, applied exactly once)
- In-app notifications with transactional outbox for e-mail/push delivery
- Reports (planned hours, staffing, unassigned, leave, status, changes) with CSV export protected against formula injection
- Plans and entitlements (Starter/Team/Business), test-mode plan switching, platform admin (tenant suspension)

## Quick start (Windows, LocalDB)

```bash
cd backend
dotnet run --project GastroTeam.Api -- migrate                                  # create/upgrade the local database
dotnet run --project GastroTeam.Api -- seed-demo --password "<demo-password>"   # optional demo tenant "Rheinblick Bistro"
dotnet run --project GastroTeam.Api --launch-profile http                       # API on http://localhost:5191

cd ../apps/web && npm ci && npm run dev                                         # web on http://localhost:5300
```

Demo logins after seeding: `inhaber@rheinblick.example` (owner), `leitung@rheinblick.example` (manager, Altstadt), `mia.schmidt@rheinblick.example` (employee) — password as chosen above.
More in [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md).

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Security](docs/SECURITY.md) · [Database](docs/DATABASE.md) · [API](docs/API.md) · [Local development](docs/LOCAL_DEVELOPMENT.md) · [Deployment](docs/DEPLOYMENT.md) · [Testing](docs/TESTING.md) · [Release checklist](docs/RELEASE_CHECKLIST.md) · [Store release](docs/STORE_RELEASE.md) · [Final QA report](docs/FINAL_QA_REPORT.md)
