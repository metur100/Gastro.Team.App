# Database

SQL Server (tested with SQL Server 2025 LocalDB, SQL Server 2025 Express on runasp.net, SQL Server 2022 in CI). EF Core 10 code-first with migrations in `backend/GastroTeam.Infrastructure/Persistence/Migrations`.

## Tables

| Area | Tables |
|---|---|
| Identity | `AspNetUsers` (+ FirstName, LastName, PreferredLanguage, IsPlatformAdmin, IsDeleted), `AspNetUser*`, `RefreshTokens`, `DataProtectionKeys` |
| Tenancy | `Tenants`, `TenantSettings` (1:1), `Memberships` (user ↔ tenant, role, permissions), `MembershipLocations` (manager scope), `Invitations` |
| Locations | `Locations` (IANA time zone, min staff, default break, prep buffer), `OpeningHours` |
| Staff | `JobRoles`, `Employees` (optional `UserId`), `EmployeeLocations`, `Availability` (versioned by `ValidFrom/ValidTo`), `AvailabilityExceptions` |
| Scheduling | `Shifts` (UTC start/end, `LocalDate`, status, rowversion), `ShiftPublications` |
| Requests | `LeaveRequests`, `ShiftSwaps` (original/final employee, rowversion) |
| Messaging | `Notifications` (unique `DedupKey`), `PushDevices`, `OutboxMessages` |
| Billing | `SubscriptionPlans` (seeded), `Subscriptions` (1 per tenant) |
| Audit | `AuditLogs` |

## Integrity

- Primary keys: UUIDv7 (`Guid.CreateVersion7`) for index-friendly ordering.
- **Tenant consistency:** alternate keys `(TenantId, Id)` on Locations, Employees, JobRoles, Shifts, Memberships; composite FKs from dependents (see SECURITY.md).
- Deletes are `Restrict`/`NoAction` by default (history is preserved; SQL Server multiple-cascade-path rules). Child collections replaced through the aggregate (`EmployeeLocations`, `MembershipLocations`, `OpeningHours`) use client-side cascade.
- Check constraints: `CK_Shifts_Interval` (`EndUtc > StartUtc`, `BreakMinutes >= 0`), `CK_LeaveRequests_Range`.
- Unique: membership per (tenant, user); employee e-mail per tenant (filtered); employee ↔ user per tenant (filtered); job role name per tenant; refresh/invitation token hashes; push token; subscription per tenant; opening hour per (location, weekday).
- Indexes on the hot paths: shifts by (tenant, location, local date) and (tenant, employee, start), leave by (tenant, employee, start) and status, notifications by (tenant, user, read, created), audit by (tenant, created), outbox by (processed, next attempt).
- Decimal precision: hours `decimal(5,2)`, prices `decimal(10,2)`.
- Concurrency: `rowversion` on Shifts, Employees, LeaveRequests, ShiftSwaps; `RevokedAt` concurrency token on RefreshTokens.
- All `DateTime` values are UTC (value converter sets `Kind=Utc` on read).

## Local database

```bash
cd backend
dotnet run --project GastroTeam.Api -- migrate          # applies migrations to ConnectionStrings:Default (Development: LocalDB "GastroTeam")
dotnet run --project GastroTeam.Api -- seed-demo --password "<demo-password>"
```

Docker alternative: `docker compose up -d` (see `docker-compose.yml`) and set `ConnectionStrings__Default`.

## Migrations

```bash
cd backend
dotnet ef migrations add <Name> -p GastroTeam.Infrastructure -s GastroTeam.Api -o Persistence/Migrations
dotnet ef migrations has-pending-model-changes -p GastroTeam.Infrastructure -s GastroTeam.Api   # CI check
```

## Production migrations (explicit step, never automatic)

```powershell
./scripts/apply-migrations.ps1 -GenerateOnly   # writes db/migrations.sql (idempotent) for review
./scripts/apply-migrations.ps1                 # asks for confirmation, applies with sqlcmd
```

Back up the database first (hosting panel). The API never calls `Migrate()` on startup.

## Demo data

`DemoSeeder` creates "Rheinblick Bistro" (Düsseldorf Altstadt + Hafen, roles Service/Küche/Bar/Schichtleitung, 11 fictional employees on `rheinblick.example`, two weeks of shifts incl. unassigned ones, pending/approved leave, a pending swap, notifications). It runs only via `seed-demo` (refused in Production unless `--allow-production`) or the Development-only `POST /api/v1/dev/seed`, and is idempotent. No default passwords: the password must be supplied.
