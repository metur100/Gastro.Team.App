# API

Base path `/api/v1`, JSON (camelCase, enums as strings, `DateOnly` = `yyyy-MM-dd`, `TimeOnly` = `HH:mm`, instants UTC ISO-8601). OpenAPI document `/openapi/v1.json` and Swagger UI `/swagger` in Development (or with `Swagger:Enabled=true`). Health: `GET /health`.

**Headers:** `Authorization: Bearer <access token>`; optional `X-Tenant-Id` (validated against memberships); `X-Client: mobile` for native token handling; `X-Requested-With: GastroTeam` for cookie-based refresh/logout.

**Errors:** RFC 7807 Problem Details: `{ status, title (German, user-facing), code, errors?, issues?, traceId }`. Common codes: `validation_failed` (400), `invalid_credentials` / `invalid_session` / `email_not_verified` / `locked_out` (401), `forbidden` / `tenant_forbidden` (403), `not_found` (404), `concurrency_conflict` / `leave_overlap` / `swap_obsolete` (409), `schedule_has_errors` / `schedule_requires_confirmation` / `plan_*` / `swap_invalid_transition` / `invitation_invalid` (422), `rate_limited` (429).

**Concurrency:** mutable resources return `version` (base64 rowversion); send it back on update/delete/decisions.

## Endpoints

| Area | Endpoints |
|---|---|
| Auth | `POST auth/register`, `auth/login`, `auth/refresh`, `auth/logout`, `auth/verify-email`, `auth/resend-verification`, `auth/forgot-password`, `auth/reset-password`, `auth/change-password`; `GET auth/me` |
| Me | `PUT me/profile`, `GET me/export`, `POST me/delete-account`, `POST/DELETE me/push-devices` |
| Onboarding | `POST onboarding/business`, `GET onboarding`, `PUT onboarding/step`, `POST onboarding/complete` |
| Settings (owner) | `GET/PUT settings/tenant`, `GET settings/members`, `POST settings/members/invite`, `PUT settings/members/{id}`, `GET settings/audit-log` |
| Locations | `GET/POST locations`, `GET/PUT locations/{id}`, `PUT locations/{id}/opening-hours` |
| Job roles | `GET/POST job-roles`, `PUT job-roles/{id}` |
| Employees | `GET employees?search&locationId&status&jobRoleId&sort&desc&page&pageSize`, `GET employees/colleagues`, `POST employees`, `GET/PUT employees/{id}`, `POST employees/{id}/deactivate|reactivate|invite|anonymize`, `GET employees/{id}/export` |
| Invitations | `GET invitations` (pending), `POST invitations/{id}/revoke`, `POST invitations/lookup`, `POST invitations/accept` |
| Shifts | `GET shifts?locationId&from&to&employeeId&jobRoleId&status&unassignedOnly`, `GET shifts/mine?from&to`, `GET/PUT/DELETE shifts/{id}`, `POST shifts`, `POST shifts/{id}/assign|cancel|duplicate|publish` |
| Schedules | `GET schedules/week?locationId&date`, `GET schedules/team?locationId&weekStart`, `GET schedules/validation?locationId&date`, `POST schedules/publish|unpublish|copy-week|copy-day` |
| Availability | `GET availability?employeeId`, `GET availability/overview?locationId`, `PUT availability/weekly`, `POST availability/exceptions`, `DELETE availability/exceptions/{id}` |
| Leave | `GET leave-requests?status&employeeId&locationId&from&to&mine&page`, `POST leave-requests`, `GET leave-requests/{id}`, `GET leave-requests/{id}/conflicts`, `POST leave-requests/{id}/approve|reject|cancel` |
| Swaps | `GET shift-swaps?scope=mine|open|manage&openOnly`, `GET shift-swaps/eligible-colleagues?shiftId`, `GET shift-swaps/{id}`, `POST shift-swaps`, `POST shift-swaps/{id}/accept|decline|approve|reject|cancel` |
| Dashboard | `GET dashboard/summary`, `dashboard/today`, `dashboard/action-items` (`?locationId`), `GET dashboard/employee` |
| Notifications | `GET notifications?unreadOnly&page`, `GET notifications/unread-count`, `POST notifications/{id}/read`, `POST notifications/read-all` |
| Reports | `GET reports/scheduled-hours|location-hours|staffing|unassigned-shifts|leave|employee-status|shift-changes?from&to&locationId&employeeId&format=csv` |
| Subscription | `GET subscription`, `POST subscription/change-plan` (test mode only) |
| Platform | `GET platform/tenants`, `POST platform/tenants/{id}/suspend|reactivate`, `GET platform/audit` |
| Dev (non-Production only) | `POST dev/seed`, `GET dev/emails?to`, `POST dev/outbox/process`, `GET dev/migrations` |

Example – create a shift:

```http
POST /api/v1/shifts
{ "locationId": "…", "jobRoleId": "…", "employeeId": null, "date": "2026-10-20", "startTime": "17:00", "endTime": "01:00", "breakMinutes": 30, "notes": null }
→ 201 { "shift": { …, "endsNextDay": true, "version": "AAAAAAAAB9E=" }, "issues": [ { "severity": "Warning", "code": "shift_unassigned", "message": "Schicht nicht besetzt." } ] }
```

Publishing a week: `POST /schedules/publish { locationId, weekStart, acknowledgeWarnings }` → 422 with `issues` if errors exist or warnings are not acknowledged.
