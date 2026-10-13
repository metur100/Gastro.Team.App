# Security

## Authentication & sessions

- ASP.NET Core Identity (PBKDF2 password hashing), minimum length 10, lockout after 5 failed attempts for 15 minutes, identical error for unknown user / wrong password, constant-ish timing for unknown users.
- Access token: JWT (HS256), 15 minutes, claims `sub`, `email`, `jti`, `sst` (hash of the security stamp). Roles are **not** in the token.
- Refresh token: 32 random bytes, stored only as SHA-256 hash, 14 days sliding, 30 days absolute per login ("family"). **Rotated on every use**; reuse of a rotated token revokes the whole family. A concurrency token on `RevokedAt` makes parallel refreshes race-safe.
- Password change/reset rotates the security stamp → all access tokens become invalid immediately and all refresh tokens are revoked.
- **Web:** refresh token in an `HttpOnly; Secure; SameSite=None; Partitioned` cookie scoped to `/api/v1/auth`; access token only in memory (never localStorage). Refresh/logout require the custom header `X-Requested-With: GastroTeam`, which forces a CORS preflight — only allow-listed origins can trigger cookie-based calls (CSRF protection). Other endpoints use bearer tokens only.
  - *Risk:* the web app (GitHub Pages) and API (runasp.net) are different sites, so the cookie is a third-party cookie. Browsers that block third-party cookies even with CHIPS/partitioning (e.g. some Safari configurations) will lose the session on page reload; users then log in again. **Recommendation:** serve app and API from the same registrable domain (e.g. `app.gastroteam.de` / `api.gastroteam.de` via Cloudflare) and switch the cookie to `SameSite=Lax`.
- **Mobile:** `X-Client: mobile` returns the refresh token in the body; stored with `expo-secure-store` (Keychain / Android Keystore).
- Rate limiting: auth endpoints 10/min per IP (refresh 60/min), global 600/min per user/IP.

## Authorisation

Every service call goes through `Access` (Application layer): `RequireOwner`, `Require(permission, locationId)`, `RequireManagedLocation`, `RequireEmployee`, `EnsureWritable`, `RequireFeature`, `RequirePlatformAdmin`. UI hiding is cosmetic only.

| Role | Scope |
|---|---|
| Platform admin (`App:PlatformAdminEmails`, verified e-mail) | Tenant list, suspend/reactivate, platform audit. **No** employee personal data. |
| Owner | Whole tenant |
| Manager | Only assigned locations; permissions: ManageEmployees, ManageSchedules, PublishSchedules, ApproveLeave, ManageSwaps, ViewReports (individually assignable on Business plan) |
| Employee | Own profile, own published shifts, team schedule of own locations (names/times only, configurable), own availability/leave, swaps |

Managers cannot approve their own leave (owners can — documented policy). Sick-leave notes are visible only to the employee and leave approvers. Colleague lists contain no contact data.

## Tenant isolation

1. Tenant context is derived from the authenticated user's active memberships; `X-Tenant-Id` is only a selection hint and is validated.
2. All tenant-owned entities implement `ITenantOwned`; EF Core global query filters compare to the resolved tenant and **fail closed** (`Guid.Empty` when unresolved). Cross-tenant code paths (auth, invitations by token, platform admin, outbox) opt out explicitly with `IgnoreQueryFilters()`.
3. Query filters are not the only protection: services check location scope and ownership explicitly (e.g. `Require(ManageSchedules, shift.LocationId)`).
4. **Database constraints:** principal entities expose alternate keys `(TenantId, Id)`; dependents reference them with composite foreign keys (`Shift → Location/Employee/JobRole`, `EmployeeLocationAssignment`, `LeaveRequest`, `ShiftSwapRequest`, availability, invitations, membership locations). A row mixing tenants cannot be inserted.
5. Integration tests (`SecurityTests`) attempt cross-tenant reads/writes, foreign tenant headers and direct mixed-tenant inserts.

## Input & output

- FluentValidation for every request DTO (central `ValidationFilter`), plus business validation in services; consistent RFC 7807 Problem Details with German `title` and machine-readable `code`. No stack traces outside Development.
- Optimistic concurrency via SQL `rowversion` (`version` field) on shifts, employees, leave and swaps → 409 `concurrency_conflict`.
- CSV export: semicolon-separated, UTF-8 BOM, fields quoted, leading `= + - @ \t \r` prefixed with `'` (formula injection).
- Invitation tokens: random, hashed at rest, single use, 7 days, looked up via POST (never in URLs logged by the server); the inviting manager may receive a shareable link (product decision, `App:ExposeInvitationLinkToInviter`).
- Security headers: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `COOP`, CSP `default-src 'none'` on API responses, HSTS outside Development.
- CORS: explicit origins from configuration, credentials allowed only for those.

## Secrets

No secrets in the repository. Development uses a non-secret dev signing key in `appsettings.Development.json`. Production values (connection string, JWT key, Web Deploy password, optional SMTP) live in `%USERPROFILE%\.gastroteam\production.env` on the deploying machine and are injected into the generated `web.config` at deploy time. Rotate the JWT key by changing the value and redeploying (forces re-login).

## Logging & audit

Serilog structured logs; no passwords, tokens, reset/invitation links or e-mail bodies are logged (the disabled e-mail sender logs only the subject). `AuditLog` records sensitive operations (logins, failed logins, tenant/settings changes, employee changes, exports, anonymisation, invitations, schedule publication, leave and swap decisions, plan changes, platform actions) without sensitive payloads.

## Privacy (GDPR support — not a compliance claim)

Technical support exists for data minimisation (no sensitive categories collected), role-based access, export (`GET /me/export`, owner export per employee), account deletion with anonymisation, employee anonymisation preserving planning history, and audit trails. Before production, the operator must still handle: privacy notice, DPA/AV contracts with restaurant customers, hosting/data-residency decision and subprocessor review (runasp.net/MonsterASP, GitHub Pages, Google Fonts, Expo push, SMTP provider), retention periods (e.g. automatic deletion of audit logs/notifications), access/deletion request procedure, incident response, and legal review of the working-time rules.

## Known gaps

- No MFA yet; no IP/device session list UI.
- Single-instance outbox (see ARCHITECTURE.md).
- Retention jobs are not automated yet.
