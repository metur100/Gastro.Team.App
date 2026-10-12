using GastroTeam.Domain.Common;

namespace GastroTeam.Domain.Entities;

/// <summary>A restaurant business. Every tenant-owned record references exactly one tenant.</summary>
public class Tenant : Entity
{
    public string Name { get; set; } = "";
    public string? ContactEmail { get; set; }
    public string? Phone { get; set; }
    public string? LogoUrl { get; set; }
    public string DefaultLanguage { get; set; } = "de-DE";
    public string DefaultTimeZone { get; set; } = "Europe/Berlin";
    public TenantStatus Status { get; set; } = TenantStatus.Active;
    public string? SuspensionReason { get; set; }
    public int OnboardingStep { get; set; }
    public DateTime? OnboardingCompletedAt { get; set; }

    public TenantSettings? Settings { get; set; }
    public Subscription? Subscription { get; set; }
}

/// <summary>Scheduling policy of a tenant. Labour-law values are configurable defaults, not legal advice.</summary>
public class TenantSettings : ITenantOwned
{
    public Guid TenantId { get; set; }
    public bool UnassignedShiftsBlockPublish { get; set; }
    public decimal MaxShiftHours { get; set; } = 10m;
    public decimal MaxDailyHours { get; set; } = 10m;
    public decimal MaxWeeklyHours { get; set; } = 48m;
    public decimal MinRestHours { get; set; } = 11m;
    public bool CheckBreakRules { get; set; } = true;
    public bool SwapRequiresManagerApproval { get; set; } = true;
    public bool AllowOpenSwapOffers { get; set; } = true;
    public bool EmployeesSeeColleagueShifts { get; set; } = true;
    /// <summary>Identifies the version of the validation rule set the values were reviewed against.</summary>
    public string RuleSetVersion { get; set; } = "basis-2026.1";
    public DateTime UpdatedAt { get; set; }
}

public class TenantMembership : Entity, ITenantOwned
{
    public Guid TenantId { get; set; }
    public Guid UserId { get; set; }
    public MembershipRole Role { get; set; }
    /// <summary>Only relevant for managers. Owners implicitly have every permission.</summary>
    public ManagerPermissions Permissions { get; set; }
    public bool IsActive { get; set; } = true;

    public Tenant? Tenant { get; set; }
    public ApplicationUser? User { get; set; }
    public List<MembershipLocation> Locations { get; set; } = [];
}

/// <summary>Explicit location scope of a manager membership.</summary>
public class MembershipLocation : ITenantOwned
{
    public Guid TenantId { get; set; }
    public Guid MembershipId { get; set; }
    public Guid LocationId { get; set; }
}

public class Invitation : Entity, ITenantOwned
{
    public Guid TenantId { get; set; }
    public string Email { get; set; } = "";
    public string FirstName { get; set; } = "";
    public string LastName { get; set; } = "";
    public MembershipRole Role { get; set; }
    public ManagerPermissions Permissions { get; set; }
    public Guid? EmployeeId { get; set; }
    /// <summary>Comma-separated location ids for manager invitations.</summary>
    public string LocationIds { get; set; } = "";
    public string TokenHash { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
    public DateTime? AcceptedAt { get; set; }
    public Guid? AcceptedByUserId { get; set; }
    public DateTime? RevokedAt { get; set; }
    public Guid InvitedByUserId { get; set; }

    public bool IsUsable(DateTime now) => AcceptedAt is null && RevokedAt is null && ExpiresAt > now;

    public IReadOnlyList<Guid> GetLocationIds() =>
        LocationIds.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(Guid.Parse).ToList();
}

public class AuditLog
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid? TenantId { get; set; }
    public Guid? UserId { get; set; }
    public string Action { get; set; } = "";
    public string EntityType { get; set; } = "";
    public Guid? EntityId { get; set; }
    /// <summary>JSON with non-sensitive context. Never contains passwords, tokens or medical details.</summary>
    public string? Details { get; set; }
    public string? IpAddress { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class OutboxMessage
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid? TenantId { get; set; }
    public string Type { get; set; } = "";
    public string Payload { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime NextAttemptAt { get; set; }
    public DateTime? ProcessedAt { get; set; }
    public int Attempts { get; set; }
    public string? LastError { get; set; }
}
