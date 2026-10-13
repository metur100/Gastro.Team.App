# Architecture

GastroTeam is a **modular monolith**: one ASP.NET Core API, one SQL Server database, two clients (web, mobile) that only talk to the API. No client ever connects to the database.

```
apps/web (React SPA, GitHub Pages) ──┐
apps/mobile (Expo / React Native) ───┼── HTTPS /api/v1 ──► GastroTeam.Api ──► SQL Server
                                     │                       │ BackgroundService: outbox → SMTP / Expo Push
```

## Backend projects

| Project | Responsibility | Depends on |
|---|---|---|
| `GastroTeam.Domain` | Entities, enums, state machines (`LeaveRequest`, `ShiftSwapRequest`, `Shift`, `Employee`), `ScheduleValidator` (pure rule engine), `ZonedTime` (DST-safe conversions), `Entitlements` | `Microsoft.Extensions.Identity.Stores` only (for `ApplicationUser : IdentityUser<Guid>`) |
| `GastroTeam.Application` | Use-case services per feature (`Features/*`), DTOs, FluentValidation validators, `RequestContext` + `Access` (authorisation), `TenantResolver`, `Notifier`, `AuditLogger`, German message catalogue (`Localization/Messages.cs`) | Domain, EF Core abstractions |
| `GastroTeam.Infrastructure` | `AppDbContext` + configurations + migrations, JWT `TokenService`, e-mail senders (SMTP / dev mailbox / disabled), Expo push sender, `OutboxProcessor`, `DemoSeeder`, DI wiring | Application |
| `GastroTeam.Api` | Thin controllers, middleware (security headers, tenant context), Problem Details mapping, central validation filter, rate limiting, CORS, cookie handling, CLI tasks (`migrate`, `seed-demo`) | Infrastructure |
| `GastroTeam.Tests` | Unit tests (domain) and integration tests (`WebApplicationFactory` + real SQL Server) | Api |

Decisions:
- **Application uses `IAppDbContext` (EF Core) directly** instead of repositories: fewer abstractions, LINQ remains testable via integration tests against SQL Server.
- **Domain rules are pure** (`ScheduleValidator.Validate(input)`); the application builds the input (shifts, context shifts of the same employees across locations, availability, leave, opening hours, policy).
- **Validation codes + German messages are separated**: the domain emits codes and arguments; `Messages` renders German text. Adding a language = adding a catalogue.
- **Roles are not in the JWT.** The token carries identity (+ security-stamp hash). Membership, role, permissions and location scope are loaded from the database on every request, so changes are effective immediately.

## Request pipeline

`ExceptionHandler → SecurityHeaders → Serilog request logging → HTTPS redirection → CORS → JWT authentication → TenantContextMiddleware → RateLimiter → Authorization → Controllers (+ ValidationFilter)`

`TenantContextMiddleware` verifies the user still exists and the token's security stamp is current (stale tokens are treated as anonymous), then resolves the tenant from the optional `X-Tenant-Id` header **only if** the user has an active membership there (otherwise 403 `tenant_forbidden`).

## Multi-tenancy

See [SECURITY.md](SECURITY.md#tenant-isolation): tenant-owned entities implement `ITenantOwned`, global query filters fail closed, composite `(TenantId, Id)` foreign keys make cross-tenant rows impossible at the database level, and services check location scope explicitly.

## Time handling

All instants are stored in UTC (`DateTime` with UTC converter). Shifts additionally store `LocalDate` (location calendar day) for week grouping. Locations store an IANA time zone. Local wall-clock input is converted with `ZonedTime`: non-existent times in the spring DST gap are rejected, ambiguous autumn times resolve to the earlier instant, and an end time ≤ start time means "next day". Durations are computed from UTC instants, so DST nights are counted correctly.

## Scheduling lifecycle

Draft → (validate) → Published → optionally Cancelled. Policy: drafts can be deleted; published shifts can only be cancelled (employee notified). Editing a published shift is allowed if it introduces no blocking error; affected employees are notified. "Unpublish week" reverts only shifts that have not started. Every publish/unpublish is recorded in `ShiftPublications` and the audit log.

## Notifications

`Notifier` writes in-app `Notification` rows **in the same transaction** as the business change plus an `OutboxMessage`. `OutboxProcessor` (hosted service, 5 s polling, exponential backoff, max 5 attempts) delivers e-mail (if the plan includes e-mail notifications and SMTP is configured) and Expo push. Failures never roll back business operations. A unique `DedupKey` index prevents duplicate notifications per event and user. Single-instance assumption: with several API instances, add row locking (`UPDLOCK, READPAST`) to the outbox query.

## Subscriptions

`SubscriptionPlan` rows (seeded via migration: Starter 19 €, Team 39 €, Business 79 € — **pricing hypotheses**, change via migration/admin) define limits and feature flags. New tenants start a 30-day trial on Business. `Access.EnsureWritable` blocks writes for suspended tenants and inactive subscriptions; plan limits and features are enforced server-side. No payment provider is integrated; `App:AllowManualPlanChange` enables clearly labelled test-mode plan changes. Integration points for billing: `Subscription.ExternalCustomerId`, `SubscriptionService.ChangePlanAsync`, a future webhook controller updating `Status`/`CurrentPeriodEnd`.

## Time & attendance (phase two)

Not implemented. The model is prepared (shifts with UTC intervals and break minutes); attendance would add `TimeEntry` (clock-in/out, breaks, corrections with approval) behind a plan feature flag. Reports explicitly label all hours as **planned**.

## Web app structure

`src/lib` (API client, auth/location context, formatting, labels, hooks), `src/components/ui` (accessible Radix-based kit), `src/features/<area>` (pages, lazy-loaded). Routing via React Router with `BrowserRouter` + `404.html` fallback on GitHub Pages.

## Mobile app structure

Expo Router routes in `src/app` (tabs: Heute, Schichten, Verfügbarkeit, Anfragen, Profil), shared components in `src/components`, API/auth/push in `src/lib`.
