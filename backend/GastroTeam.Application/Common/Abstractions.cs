using GastroTeam.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace GastroTeam.Application.Common;

public interface IAppDbContext
{
    DbSet<ApplicationUser> Users { get; }
    DbSet<RefreshToken> RefreshTokens { get; }
    DbSet<Tenant> Tenants { get; }
    DbSet<TenantSettings> TenantSettings { get; }
    DbSet<TenantMembership> Memberships { get; }
    DbSet<MembershipLocation> MembershipLocations { get; }
    DbSet<Invitation> Invitations { get; }
    DbSet<RestaurantLocation> Locations { get; }
    DbSet<LocationOpeningHour> OpeningHours { get; }
    DbSet<JobRole> JobRoles { get; }
    DbSet<Employee> Employees { get; }
    DbSet<EmployeeLocationAssignment> EmployeeLocations { get; }
    DbSet<EmployeeAvailability> Availability { get; }
    DbSet<AvailabilityException> AvailabilityExceptions { get; }
    DbSet<Shift> Shifts { get; }
    DbSet<ShiftPublication> ShiftPublications { get; }
    DbSet<LeaveRequest> LeaveRequests { get; }
    DbSet<ShiftSwapRequest> ShiftSwaps { get; }
    DbSet<Notification> Notifications { get; }
    DbSet<PushDevice> PushDevices { get; }
    DbSet<SubscriptionPlan> SubscriptionPlans { get; }
    DbSet<Subscription> Subscriptions { get; }
    DbSet<AuditLog> AuditLogs { get; }
    DbSet<OutboxMessage> OutboxMessages { get; }

    DatabaseFacade Database { get; }
    EntityEntry<TEntity> Entry<TEntity>(TEntity entity) where TEntity : class;
    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}

public interface IClock
{
    DateTime UtcNow { get; }
}

public sealed class SystemClock : IClock
{
    public DateTime UtcNow => DateTime.UtcNow;
}

public interface IEmailSender
{
    bool IsConfigured { get; }
    Task SendAsync(string to, string subject, string htmlBody, string textBody, CancellationToken ct);
}

public interface IPushSender
{
    Task SendAsync(IReadOnlyList<string> deviceTokens, string title, string body, string? link, CancellationToken ct);
}

public interface ITokenService
{
    (string Token, DateTime ExpiresAt) CreateAccessToken(ApplicationUser user);
    string GenerateOpaqueToken();
    string Hash(string token);
}

public sealed record PagedResult<T>(IReadOnlyList<T> Items, int Page, int PageSize, int TotalCount);

public sealed class AppOptions
{
    public const string Section = "App";
    /// <summary>Base URL of the web frontend, used to build links in e-mails (no trailing slash).</summary>
    public string WebBaseUrl { get; set; } = "http://localhost:5173";
    public bool RequireEmailVerification { get; set; } = true;
    /// <summary>
    /// Returns the invitation link to the inviting owner/manager so it can be shared via a messenger.
    /// Product decision; disable if invitations must only travel by e-mail.
    /// </summary>
    public bool ExposeInvitationLinkToInviter { get; set; } = true;
    /// <summary>Allows plan changes without a payment provider. Must be clearly labelled as test mode.</summary>
    public bool AllowManualPlanChange { get; set; }
    public int TrialDays { get; set; } = 30;
    public string TrialPlanCode { get; set; } = "business";
    public int InvitationValidityDays { get; set; } = 7;
    /// <summary>E-mail addresses that are granted the platform administrator flag on login.</summary>
    public string[] PlatformAdminEmails { get; set; } = [];
}
