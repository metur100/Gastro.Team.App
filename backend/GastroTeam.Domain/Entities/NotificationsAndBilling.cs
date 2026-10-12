using GastroTeam.Domain.Common;

namespace GastroTeam.Domain.Entities;

public class Notification : ITenantOwned
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public string Type { get; set; } = "";
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    /// <summary>Relative app route, e.g. "/urlaub".</summary>
    public string? Link { get; set; }
    /// <summary>Optional idempotency key; a unique index prevents duplicate notifications for the same event.</summary>
    public string? DedupKey { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? ReadAt { get; set; }
}

public class PushDevice
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid UserId { get; set; }
    public string Token { get; set; } = "";
    public string Platform { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime LastSeenAt { get; set; }
}

/// <summary>Configurable plan. Prices are product hypotheses and live in data, not code.</summary>
public class SubscriptionPlan
{
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public decimal MonthlyPriceEur { get; set; }
    public int MaxLocations { get; set; }
    public int MaxActiveEmployees { get; set; }
    public PlanFeatures Features { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

public class Subscription : ITenantOwned
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public string PlanCode { get; set; } = "";
    public SubscriptionStatus Status { get; set; }
    public DateTime? TrialEndsAt { get; set; }
    public DateTime? CurrentPeriodEnd { get; set; }
    public DateTime? CancelledAt { get; set; }
    /// <summary>True when the plan was set without a payment provider (development / test mode).</summary>
    public bool IsTestMode { get; set; } = true;
    public string? ExternalCustomerId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public SubscriptionPlan? Plan { get; set; }
}

public static class Entitlements
{
    /// <summary>Statuses in which the tenant can change data. Read access is kept for all statuses.</summary>
    public static bool AllowsWrites(SubscriptionStatus status, DateTime? trialEndsAt, DateTime now) => status switch
    {
        SubscriptionStatus.Active => true,
        SubscriptionStatus.PastDue => true, // grace period; billing provider decides when to suspend
        SubscriptionStatus.Trial => trialEndsAt is null || trialEndsAt > now,
        _ => false
    };

    public static void EnsureCanAddLocation(SubscriptionPlan plan, int currentLocations)
    {
        if (currentLocations >= plan.MaxLocations) throw new DomainException("plan_location_limit");
    }

    public static void EnsureCanActivateEmployee(SubscriptionPlan plan, int currentActiveEmployees)
    {
        if (currentActiveEmployees >= plan.MaxActiveEmployees) throw new DomainException("plan_employee_limit");
    }

    public static void EnsureFeature(SubscriptionPlan plan, PlanFeatures feature)
    {
        if (!plan.Features.HasFlag(feature)) throw new DomainException("plan_feature_missing", feature.ToString());
    }
}
