# Deployment

| Component | Target | How |
|---|---|---|
| API | MonsterASP.NET / runasp.net site → `https://gastroteam.runasp.net` (IIS, .NET 10, framework-dependent) | `scripts/deploy-api.ps1` (Web Deploy) |
| Database | SQL Server 2025 Express (hosting provider database) | `scripts/apply-migrations.ps1` (idempotent script via sqlcmd) |
| Web app | GitHub Pages `https://metur100.github.io/GastroTeam/` | GitHub Actions `deploy-web.yml` on push to `main` |
| Landing page | GitHub Pages `https://metur100.github.io/GastroTeam.Landing/` | separate repo, `deploy.yml` |

GitHub hosts only static files; the API and database run at the ASP.NET host.

## Secrets file (outside the repository)

`%USERPROFILE%\.gastroteam\production.env` on the deploying machine:

```
GT_DB_SERVER=…            GT_DB_NAME=…      GT_DB_USER=…      GT_DB_PASSWORD=…
GT_CONNECTION=Server=…; Database=…; User Id=…; Password=…; Encrypt=True; TrustServerCertificate=True;
GT_JWT_SIGNING_KEY=<48 random bytes, base64url>
GT_DEPLOY_SERVER=<siteNNN>.siteasp.net   GT_DEPLOY_SITE=<siteNNN>   GT_DEPLOY_USER=<siteNNN>   GT_DEPLOY_PASSWORD=…
GT_API_URL=https://gastroteam.runasp.net
GT_WEB_URL=https://metur100.github.io/GastroTeam
GT_WEB_ORIGIN=https://metur100.github.io
# optional
GT_SMTP_HOST=  GT_SMTP_PORT=  GT_SMTP_USER=  GT_SMTP_PASSWORD=  GT_SMTP_FROM=
GT_REQUIRE_EMAIL_VERIFICATION=   # default false until SMTP is configured
GT_ALLOW_MANUAL_PLAN_CHANGE=     # default true (test mode, no payments)
GT_PLATFORM_ADMIN_EMAIL=
```

The deploy script writes these into the published `web.config` as environment variables (`ConnectionStrings__Default`, `Jwt__SigningKey`, `App__*`, `Cors__AllowedOrigins__0`, `Email__*`). The repository's `appsettings.json` contains no secrets.

## API release

```powershell
./scripts/apply-migrations.ps1      # review db/migrations.sql first; back up the DB in the hosting panel
./scripts/deploy-api.ps1            # dotnet publish -c Release + msdeploy (App_Offline during sync)
curl https://gastroteam.runasp.net/health
```

If the host ever lacks the .NET runtime, use `./scripts/deploy-api.ps1 -SelfContained`. For startup diagnostics use `-StdoutLogs` (writes `logs/stdout*` on the server; turn off again afterwards).

## Current production configuration (test environment)

- `ASPNETCORE_ENVIRONMENT=Production` (dev endpoints and Swagger removed, HSTS on, no exception details).
- **No SMTP configured** → `App:RequireEmailVerification=false` so registration works; verification, reset and invitation e-mails are **not sent** (invitation links are shown to the inviting manager to share). Configure SMTP and set `GT_REQUIRE_EMAIL_VERIFICATION=true` before real use.
- **No payment provider** → plan changes possible in labelled test mode.
- Refresh cookie `SameSite=None; Secure; Partitioned` because app and API are on different sites (see SECURITY.md for the recommended same-site setup via a custom domain + Cloudflare).

## Web app (GitHub Pages)

1. Repository `metur100/GastroTeam` → *Settings → Pages → Source: GitHub Actions*.
2. Optional repository variable `API_BASE_URL` (defaults to `https://gastroteam.runasp.net`).
3. Push to `main` → `deploy-web.yml` builds with base `/GastroTeam/` and writes `404.html` for client routing.
4. If the Pages origin changes (custom domain), update `GT_WEB_URL`/`GT_WEB_ORIGIN` and redeploy the API (CORS + e-mail links).

## Cloudflare (recommended next step)

Point a domain (e.g. `gastroteam.de`) to GitHub Pages (`app.`), the API host (`api.`, via CNAME as documented by the host) and the landing page (apex/`www`), enable "Full (strict)" TLS, and then switch the refresh cookie to `SameSite=Lax`. Add `public/CNAME` in the web app and landing page.

## CI

`ci.yml` runs on PRs and pushes to `main`: backend build (vulnerable packages fail), unit + integration tests against a SQL Server 2022 service container, migration drift check, web typecheck/lint/tests/build/audit, mobile typecheck/tests. Set the secret `CI_SQL_SA_PASSWORD` to override the CI-only default SA password.
