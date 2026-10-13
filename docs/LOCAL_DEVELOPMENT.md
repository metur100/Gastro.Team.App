# Local development

## Prerequisites

- .NET SDK 10 (`dotnet --list-sdks`), `dotnet-ef` tool (`dotnet tool install -g dotnet-ef`)
- Node.js 22 + npm
- SQL Server: Windows **LocalDB** (default) or Docker (`docker compose up -d`)
- Optional: Playwright browsers (`cd apps/web && npx playwright install chromium`)

## API (port 5191)

```bash
cd backend
dotnet run --project GastroTeam.Api -- migrate
dotnet run --project GastroTeam.Api -- seed-demo --password "<demo-password>"   # optional
dotnet run --project GastroTeam.Api --launch-profile http
```

Development settings (`appsettings.Development.json`): LocalDB database `GastroTeam`, dev JWT key (not secret), in-memory **dev mailbox** (`GET /api/v1/dev/emails?to=<address>` shows verification, reset and invitation e-mails), test-mode plan changes, relaxed auth rate limit. Swagger UI: `http://localhost:5191/swagger`.

Using Docker SQL Server instead: set `ConnectionStrings__Default="Server=localhost,1433;Database=GastroTeam;User Id=sa;Password=<pw>;TrustServerCertificate=True"`.

## Web app (port 5300)

```bash
cd apps/web
npm ci
npm run dev        # Vite proxies /api to http://localhost:5191 (VITE_DEV_API_TARGET), so the refresh cookie is first-party
```

## Mobile app

```bash
cd apps/mobile
npm ci
EXPO_PUBLIC_API_URL=http://<LAN-IP>:5191 npx expo start
```

The API listens on localhost only by default; for a phone on the LAN start it with `ASPNETCORE_URLS=http://0.0.0.0:5191` (development only).

## Creating local test users without weakening production

- Use `seed-demo` (CLI) or `POST /api/v1/dev/seed` — both refuse to run in Production.
- Or register normally and read the verification link from the dev mailbox.

## Useful commands

| Task | Command |
|---|---|
| Backend build | `dotnet build backend/GastroTeam.sln` |
| Backend tests | `dotnet test backend/GastroTeam.Tests` |
| New migration | `dotnet ef migrations add <Name> -p backend/GastroTeam.Infrastructure -s backend/GastroTeam.Api -o Persistence/Migrations` |
| Web checks | `cd apps/web && npx tsc -b && npx oxlint src && npx vitest run` |
| Web E2E | `cd apps/web && npx playwright test` (API + Vite running) |
| Web production build | `cd apps/web && VITE_API_BASE_URL=https://gastroteam.runasp.net npm run build` |
| Mobile checks | `cd apps/mobile && npx tsc --noEmit && npx jest && npx expo-doctor` |
| API smoke test | `node scripts/smoke-test.mjs http://localhost:5191 <demo-password>` |
