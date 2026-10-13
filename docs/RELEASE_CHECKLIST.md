# Release checklist

## Before every release

- [ ] CI green (backend unit + integration on SQL Server, web, mobile)
- [ ] `dotnet ef migrations has-pending-model-changes` → no changes
- [ ] Database backup taken in the hosting panel
- [ ] `scripts/apply-migrations.ps1 -GenerateOnly` reviewed, then applied
- [ ] `scripts/deploy-api.ps1` → `/health` returns `ok`
- [ ] Web deployed via GitHub Actions; hard-refresh the site, check login, schedule, publish
- [ ] Playwright suite against the deployed URL (`E2E_BASE_URL=…`)
- [ ] No secrets in the diff (`git grep` for passwords/keys), `npm audit --omit=dev`, `dotnet list package --vulnerable`

## Before the first real customers (open items)

- [x] **SMTP provider** configured (`GT_SMTP_*`), e-mail verification enforced
- [ ] **Same-site domain** (Cloudflare): `app.` / `api.` on one registrable domain, cookie `SameSite=Lax`, update CORS and `App:WebBaseUrl`
- [ ] **Legal:** Impressum, Datenschutzerklärung, AGB/Nutzungsbedingungen, AV-Vertrag (DPA) template for restaurant customers
- [ ] Hosting/data-residency decision documented; subprocessor list (API host, GitHub Pages, Google Fonts → consider self-hosting, Expo push, SMTP)
- [ ] Retention policy (audit logs, notifications, refresh tokens, outbox) and deletion/access request procedure
- [ ] Incident response contact and process
- [ ] **Legal review of working-time rules** (ArbZG, Tarifverträge); adjust defaults and `RuleSetVersion`
- [ ] Payment provider integration (Stripe/Mollie/Paddle…), invoices, VAT, cancellation flow (§ 312k BGB "Kündigungsbutton"); disable `GT_ALLOW_MANUAL_PLAN_CHANGE`
- [ ] Validate pricing hypotheses (19/39/79 €)
- [ ] Platform admin e-mail configured (`GT_PLATFORM_ADMIN_EMAIL`)
- [ ] Remove E2E/test tenants from production (`@e2e.gastroteam.example`)
- [ ] Monitoring/alerting for `/health` and error logs; log retention on the host
- [ ] JWT signing key rotation procedure tested
- [ ] Mobile store release (see STORE_RELEASE.md)
