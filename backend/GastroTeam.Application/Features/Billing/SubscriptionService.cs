using GastroTeam.Application.Common;
using GastroTeam.Application.Features.Account;
using GastroTeam.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace GastroTeam.Application.Features.Billing;

public sealed record PlanDto(string Code, string Name, decimal MonthlyPriceEur, int MaxLocations, int MaxActiveEmployees, IReadOnlyList<string> Features);
public sealed record UsageDto(int ActiveLocations, int ActiveEmployees);
public sealed record SubscriptionDto(SubscriptionSummary Current, UsageDto Usage, IReadOnlyList<PlanDto> Plans, bool ManualPlanChangeAllowed);
public sealed record ChangePlanRequest(string PlanCode);

public sealed record TenantAdminDto(Guid Id, string Name, TenantStatus Status, string? SuspensionReason, string PlanCode, SubscriptionStatus SubscriptionStatus,
    DateTime? TrialEndsAt, int Locations, int ActiveEmployees, DateTime CreatedAt);
public sealed record SuspendTenantRequest(string Reason);
public sealed record AuditLogDto(Guid Id, DateTime CreatedAt, string Action, string EntityType, Guid? EntityId, string? UserName, string? Details);

/// <summary>
/// Plan and entitlement management. No payment provider is integrated: plan changes are only possible
/// when explicitly enabled (test mode) and are flagged as such. No payment is ever simulated.
/// </summary>
public sealed class SubscriptionService(IAppDbContext db, Access access, AuditLogger audit, IClock clock, IOptions<AppOptions> options)
{
    public async Task<SubscriptionDto> GetAsync(CancellationToken ct)
    {
        access.RequireOwner();
        var sub = await db.Subscriptions.Include(s => s.Plan).SingleAsync(ct);
        var plans = await db.SubscriptionPlans.Where(p => p.IsActive).OrderBy(p => p.SortOrder).ToListAsync(ct);
        var usage = new UsageDto(
            await db.Locations.CountAsync(l => l.IsActive, ct),
            await db.Employees.CountAsync(e => e.Status == EmployeeStatus.Active || e.Status == EmployeeStatus.Invited, ct));
        return new SubscriptionDto(AccountService.ToSummary(sub, clock.UtcNow), usage, plans.Select(ToDto).ToList(), options.Value.AllowManualPlanChange);
    }

    public async Task<SubscriptionDto> ChangePlanAsync(ChangePlanRequest r, CancellationToken ct)
    {
        access.RequireOwner();
        if (!options.Value.AllowManualPlanChange)
            throw new BusinessRuleException("billing_not_configured",
                "Die Zahlungsabwicklung ist noch nicht angebunden. Bitte kontaktieren Sie den Support für einen Tarifwechsel.");
        var plan = await db.SubscriptionPlans.SingleOrDefaultAsync(p => p.Code == r.PlanCode && p.IsActive, ct)
                   ?? throw RequestValidationException.For("planCode", "Unbekannter Tarif.");
        var activeLocations = await db.Locations.CountAsync(l => l.IsActive, ct);
        var activeEmployees = await db.Employees.CountAsync(e => e.Status == EmployeeStatus.Active || e.Status == EmployeeStatus.Invited, ct);
        if (activeLocations > plan.MaxLocations)
            throw new BusinessRuleException("plan_downgrade_blocked", $"Der Tarif {plan.Name} erlaubt nur {plan.MaxLocations} aktive Standorte. Bitte deaktivieren Sie zuerst Standorte.");
        if (activeEmployees > plan.MaxActiveEmployees)
            throw new BusinessRuleException("plan_downgrade_blocked", $"Der Tarif {plan.Name} erlaubt nur {plan.MaxActiveEmployees} aktive Mitarbeitende. Bitte deaktivieren Sie zuerst Mitarbeitende.");

        var sub = await db.Subscriptions.SingleAsync(ct);
        var previous = sub.PlanCode;
        sub.PlanCode = plan.Code;
        sub.IsTestMode = true;
        if (sub.Status == SubscriptionStatus.Trial && sub.TrialEndsAt <= clock.UtcNow) sub.TrialEndsAt = clock.UtcNow.AddDays(options.Value.TrialDays);
        sub.UpdatedAt = clock.UtcNow;
        audit.Log("subscription.plan_changed_test_mode", "Subscription", sub.Id, new { previous, plan.Code });
        await db.SaveChangesAsync(ct);
        return await GetAsync(ct);
    }

    public static PlanDto ToDto(SubscriptionPlan p) => new(p.Code, p.Name, p.MonthlyPriceEur, p.MaxLocations, p.MaxActiveEmployees,
        Enum.GetValues<PlanFeatures>().Where(f => f != PlanFeatures.None && p.Features.HasFlag(f)).Select(f => f.ToString()).ToList());
}

/// <summary>Platform operator functions. Deliberately limited to tenant-level metadata — no employee personal data.</summary>
public sealed class PlatformService(IAppDbContext db, Access access, AuditLogger audit, IClock clock)
{
    public async Task<IReadOnlyList<TenantAdminDto>> ListTenantsAsync(CancellationToken ct)
    {
        access.RequirePlatformAdmin();
        return await db.Tenants.IgnoreQueryFilters().OrderByDescending(t => t.CreatedAt)
            .Select(t => new TenantAdminDto(t.Id, t.Name, t.Status, t.SuspensionReason,
                t.Subscription != null ? t.Subscription.PlanCode : "none",
                t.Subscription != null ? t.Subscription.Status : SubscriptionStatus.Suspended,
                t.Subscription != null ? t.Subscription.TrialEndsAt : null,
                db.Locations.IgnoreQueryFilters().Count(l => l.TenantId == t.Id && l.IsActive),
                db.Employees.IgnoreQueryFilters().Count(e => e.TenantId == t.Id && (e.Status == EmployeeStatus.Active || e.Status == EmployeeStatus.Invited)),
                t.CreatedAt))
            .Take(500).ToListAsync(ct);
    }

    public async Task SetStatusAsync(Guid tenantId, bool suspend, string? reason, CancellationToken ct)
    {
        access.RequirePlatformAdmin();
        var t = await db.Tenants.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.Id == tenantId, ct) ?? throw new NotFoundException();
        if (suspend && string.IsNullOrWhiteSpace(reason)) throw RequestValidationException.For("reason", "Bitte geben Sie einen Grund an.");
        t.Status = suspend ? TenantStatus.Suspended : TenantStatus.Active;
        t.SuspensionReason = suspend ? reason!.Trim() : null;
        t.UpdatedAt = clock.UtcNow;
        audit.Log(suspend ? "platform.tenant_suspended" : "platform.tenant_reactivated", "Tenant", t.Id, new { reason }, t.Id);
        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<AuditLogDto>> PlatformAuditAsync(CancellationToken ct)
    {
        access.RequirePlatformAdmin();
        return await db.AuditLogs.Where(a => a.Action.StartsWith("platform.") || a.Action == "tenant.created")
            .OrderByDescending(a => a.CreatedAt).Take(200)
            .Select(a => new AuditLogDto(a.Id, a.CreatedAt, a.Action, a.EntityType, a.EntityId, null, null))
            .ToListAsync(ct);
    }
}

public sealed class AuditQueryService(IAppDbContext db, Access access)
{
    public async Task<PagedResult<AuditLogDto>> ListAsync(int page, int pageSize, string? entityType, CancellationToken ct)
    {
        access.RequireOwner();
        var tenantId = access.TenantId;
        var q = db.AuditLogs.Where(a => a.TenantId == tenantId);
        if (!string.IsNullOrWhiteSpace(entityType)) q = q.Where(a => a.EntityType == entityType);
        var result = await q.OrderByDescending(a => a.CreatedAt).ToPagedAsync(page, pageSize, ct);
        var userIds = result.Items.Where(a => a.UserId != null).Select(a => a.UserId!.Value).Distinct().ToList();
        var names = await db.Users.Where(u => userIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.FirstName + " " + u.LastName, ct);
        return new PagedResult<AuditLogDto>(result.Items.Select(a => new AuditLogDto(a.Id, a.CreatedAt, a.Action, a.EntityType, a.EntityId,
            a.UserId is { } u ? names.GetValueOrDefault(u) : null, a.Details)).ToList(), result.Page, result.PageSize, result.TotalCount);
    }
}
