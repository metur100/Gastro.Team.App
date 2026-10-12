using GastroTeam.Domain.Entities;

namespace GastroTeam.Application.Common;

/// <summary>
/// Per-request identity and tenant context. Populated by the API from the validated access token and
/// the database (memberships). Never populated from client-supplied roles or tenant claims.
/// </summary>
public sealed class RequestContext
{
    public Guid? UserId { get; set; }
    public string? Email { get; set; }
    public bool IsPlatformAdmin { get; set; }
    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }

    public Guid? TenantId { get; set; }
    public Guid? MembershipId { get; set; }
    public MembershipRole? Role { get; set; }
    public ManagerPermissions Permissions { get; set; }
    /// <summary>Locations the member may manage. Owners: all active locations of the tenant.</summary>
    public IReadOnlySet<Guid> ManagedLocationIds { get; set; } = new HashSet<Guid>();
    /// <summary>The employee record linked to the user in the current tenant, if any.</summary>
    public Guid? EmployeeId { get; set; }
    public IReadOnlySet<Guid> EmployeeLocationIds { get; set; } = new HashSet<Guid>();
    public TenantStatus TenantStatus { get; set; }
    public SubscriptionPlan? Plan { get; set; }
    public SubscriptionStatus SubscriptionStatus { get; set; }
    public DateTime? TrialEndsAt { get; set; }

    public bool IsOwner => Role == MembershipRole.Owner;
    public bool IsManagerOrOwner => Role is MembershipRole.Owner or MembershipRole.Manager;

    public ManagerPermissions EffectivePermissions => Role switch
    {
        MembershipRole.Owner => ManagerPermissions.All,
        MembershipRole.Manager => Permissions,
        _ => ManagerPermissions.None
    };

    /// <summary>Every location the member may see (managed + own employee locations).</summary>
    public IReadOnlySet<Guid> VisibleLocationIds => ManagedLocationIds.Union(EmployeeLocationIds).ToHashSet();

    /// <summary>Tenant id used by global query filters; <see cref="Guid.Empty"/> matches nothing.</summary>
    public Guid FilterTenantId => TenantId ?? Guid.Empty;
}

/// <summary>Central authorisation checks used by all application services.</summary>
public sealed class Access(RequestContext ctx, IClock clock)
{
    public RequestContext Context => ctx;

    public Guid UserId => ctx.UserId ?? throw new UnauthorizedException("unauthenticated", "Bitte melden Sie sich an.");

    public Guid TenantId
    {
        get
        {
            _ = UserId;
            return ctx.TenantId ?? throw new ForbiddenException("Sie sind keinem Restaurant zugeordnet.");
        }
    }

    public void RequireOwner()
    {
        _ = TenantId;
        if (!ctx.IsOwner) throw new ForbiddenException("Diese Aktion ist nur für Inhaberinnen und Inhaber verfügbar.");
    }

    public void RequireManager()
    {
        _ = TenantId;
        if (!ctx.IsManagerOrOwner) throw new ForbiddenException();
    }

    public bool Has(ManagerPermissions permission) => ctx.EffectivePermissions.HasFlag(permission);

    public void Require(ManagerPermissions permission)
    {
        RequireManager();
        if (!Has(permission)) throw new ForbiddenException();
    }

    /// <summary>Ensures the location is in the member's management scope (owners: whole tenant).</summary>
    public void RequireManagedLocation(Guid locationId)
    {
        RequireManager();
        if (!ctx.ManagedLocationIds.Contains(locationId))
            throw new ForbiddenException("Sie haben keinen Zugriff auf diesen Standort.");
    }

    public void Require(ManagerPermissions permission, Guid locationId)
    {
        Require(permission);
        RequireManagedLocation(locationId);
    }

    public bool ManagesAny(IEnumerable<Guid> locationIds) => locationIds.Any(ctx.ManagedLocationIds.Contains);

    public Guid RequireEmployee() =>
        ctx.EmployeeId ?? throw new ForbiddenException("Ihr Konto ist mit keinem Mitarbeiterprofil verknüpft.");

    /// <summary>Blocks writes for suspended tenants and inactive subscriptions.</summary>
    public void EnsureWritable()
    {
        _ = TenantId;
        if (ctx.TenantStatus == TenantStatus.Suspended)
            throw new ForbiddenException("Dieses Restaurantkonto ist gesperrt. Bitte wenden Sie sich an den Support.");
        if (!Domain.Entities.Entitlements.AllowsWrites(ctx.SubscriptionStatus, ctx.TrialEndsAt, clock.UtcNow))
            throw new BusinessRuleException("subscription_inactive",
                "Ihr Abonnement ist nicht aktiv. Bitte wählen Sie einen Tarif, um Änderungen vorzunehmen.");
    }

    public SubscriptionPlan Plan => ctx.Plan ?? throw new ForbiddenException();

    public void RequireFeature(PlanFeatures feature)
    {
        if (!Plan.Features.HasFlag(feature))
            throw new BusinessRuleException("plan_feature_missing", "Diese Funktion ist in Ihrem aktuellen Tarif nicht enthalten.");
    }

    public void RequirePlatformAdmin()
    {
        _ = UserId;
        if (!ctx.IsPlatformAdmin) throw new ForbiddenException();
    }
}
