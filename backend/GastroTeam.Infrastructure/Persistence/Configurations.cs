using GastroTeam.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace GastroTeam.Infrastructure.Persistence;

internal sealed class UserConfig : IEntityTypeConfiguration<ApplicationUser>
{
    public void Configure(EntityTypeBuilder<ApplicationUser> e)
    {
        e.Property(x => x.FirstName).HasMaxLength(100);
        e.Property(x => x.LastName).HasMaxLength(100);
        e.Property(x => x.PreferredLanguage).HasMaxLength(10);
        e.Ignore(x => x.FullName);
    }
}

internal sealed class RefreshTokenConfig : IEntityTypeConfiguration<RefreshToken>
{
    public void Configure(EntityTypeBuilder<RefreshToken> e)
    {
        e.HasKey(x => x.Id);
        e.Property(x => x.TokenHash).HasMaxLength(64).IsRequired();
        e.HasIndex(x => x.TokenHash).IsUnique();
        e.HasIndex(x => x.FamilyId);
        e.HasIndex(x => x.UserId);
        e.Property(x => x.RevokedReason).HasMaxLength(40);
        e.Property(x => x.CreatedByIp).HasMaxLength(64);
        e.Property(x => x.UserAgent).HasMaxLength(300);
        // Two concurrent refreshes with the same token: only the first can flip RevokedAt.
        e.Property(x => x.RevokedAt).IsConcurrencyToken();
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UserId);
    }
}

internal sealed class TenantConfig : IEntityTypeConfiguration<Tenant>
{
    public void Configure(EntityTypeBuilder<Tenant> e)
    {
        e.Property(x => x.Name).HasMaxLength(150).IsRequired();
        e.Property(x => x.ContactEmail).HasMaxLength(256);
        e.Property(x => x.Phone).HasMaxLength(40);
        e.Property(x => x.LogoUrl).HasMaxLength(500);
        e.Property(x => x.DefaultLanguage).HasMaxLength(10);
        e.Property(x => x.DefaultTimeZone).HasMaxLength(64);
        e.Property(x => x.SuspensionReason).HasMaxLength(500);
        e.HasOne(x => x.Settings).WithOne().HasForeignKey<TenantSettings>(s => s.TenantId);
        e.HasOne(x => x.Subscription).WithOne().HasForeignKey<Subscription>(s => s.TenantId);
    }
}

internal sealed class TenantSettingsConfig : IEntityTypeConfiguration<TenantSettings>
{
    public void Configure(EntityTypeBuilder<TenantSettings> e)
    {
        e.HasKey(x => x.TenantId);
        e.Property(x => x.MaxShiftHours).HasPrecision(5, 2);
        e.Property(x => x.MaxDailyHours).HasPrecision(5, 2);
        e.Property(x => x.MaxWeeklyHours).HasPrecision(5, 2);
        e.Property(x => x.MinRestHours).HasPrecision(5, 2);
        e.Property(x => x.RuleSetVersion).HasMaxLength(40);
    }
}

internal sealed class MembershipConfig : IEntityTypeConfiguration<TenantMembership>
{
    public void Configure(EntityTypeBuilder<TenantMembership> e)
    {
        e.HasAlternateKey(x => new { x.TenantId, x.Id });
        e.HasIndex(x => new { x.TenantId, x.UserId }).IsUnique();
        e.HasIndex(x => x.UserId);
        e.HasOne(x => x.Tenant).WithMany().HasForeignKey(x => x.TenantId);
        e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId);
    }
}

internal sealed class MembershipLocationConfig : IEntityTypeConfiguration<MembershipLocation>
{
    public void Configure(EntityTypeBuilder<MembershipLocation> e)
    {
        e.HasKey(x => new { x.MembershipId, x.LocationId });
        e.HasOne<RestaurantLocation>().WithMany().HasForeignKey(x => new { x.TenantId, x.LocationId }).HasPrincipalKey(l => new { l.TenantId, l.Id });
    }
}

internal sealed class InvitationConfig : IEntityTypeConfiguration<Invitation>
{
    public void Configure(EntityTypeBuilder<Invitation> e)
    {
        e.Property(x => x.Email).HasMaxLength(256).IsRequired();
        e.Property(x => x.FirstName).HasMaxLength(100);
        e.Property(x => x.LastName).HasMaxLength(100);
        e.Property(x => x.LocationIds).HasMaxLength(2000);
        e.Property(x => x.TokenHash).HasMaxLength(64).IsRequired();
        e.HasIndex(x => x.TokenHash).IsUnique();
        e.HasIndex(x => new { x.TenantId, x.Email });
        e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId);
        e.HasOne<Employee>().WithMany().HasForeignKey(x => new { x.TenantId, x.EmployeeId }).HasPrincipalKey(x => new { x.TenantId, x.Id });
    }
}

internal sealed class LocationConfig : IEntityTypeConfiguration<RestaurantLocation>
{
    public void Configure(EntityTypeBuilder<RestaurantLocation> e)
    {
        e.HasTenantKey();
        e.Property(x => x.Name).HasMaxLength(120).IsRequired();
        e.Property(x => x.Street).HasMaxLength(150);
        e.Property(x => x.PostalCode).HasMaxLength(10);
        e.Property(x => x.City).HasMaxLength(100);
        e.Property(x => x.Country).HasMaxLength(2);
        e.Property(x => x.TimeZoneId).HasMaxLength(64).IsRequired();
        e.Property(x => x.Phone).HasMaxLength(40);
        e.Property(x => x.Email).HasMaxLength(256);
        e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId);
    }
}

internal sealed class OpeningHourConfig : IEntityTypeConfiguration<LocationOpeningHour>
{
    public void Configure(EntityTypeBuilder<LocationOpeningHour> e)
    {
        e.HasIndex(x => new { x.LocationId, x.DayOfWeek }).IsUnique();
    }
}

internal sealed class JobRoleConfig : IEntityTypeConfiguration<JobRole>
{
    public void Configure(EntityTypeBuilder<JobRole> e)
    {
        e.HasTenantKey();
        e.Property(x => x.Name).HasMaxLength(60).IsRequired();
        e.Property(x => x.Color).HasMaxLength(7).IsRequired();
        e.HasIndex(x => new { x.TenantId, x.Name }).IsUnique();
        e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId);
    }
}

internal sealed class EmployeeConfig : IEntityTypeConfiguration<Employee>
{
    public void Configure(EntityTypeBuilder<Employee> e)
    {
        e.HasTenantKey();
        e.Property(x => x.FirstName).HasMaxLength(100).IsRequired();
        e.Property(x => x.LastName).HasMaxLength(100).IsRequired();
        e.Property(x => x.Email).HasMaxLength(256);
        e.Property(x => x.NormalizedEmail).HasMaxLength(256);
        e.Property(x => x.Phone).HasMaxLength(40);
        e.Property(x => x.ProfileImageUrl).HasMaxLength(500);
        e.Property(x => x.PreferredLanguage).HasMaxLength(10);
        e.Property(x => x.Notes).HasMaxLength(1000);
        e.Property(x => x.ContractHoursPerWeek).HasPrecision(5, 2);
        e.Ignore(x => x.FullName);
        e.HasIndex(x => new { x.TenantId, x.NormalizedEmail }).IsUnique().HasFilter("[NormalizedEmail] IS NOT NULL");
        e.HasIndex(x => new { x.TenantId, x.UserId }).IsUnique().HasFilter("[UserId] IS NOT NULL");
        e.HasIndex(x => new { x.TenantId, x.Status, x.LastName });
        e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UserId);
        e.HasOne(x => x.JobRole).WithMany().HasForeignKey(x => new { x.TenantId, x.JobRoleId }).HasPrincipalKey(r => new { r.TenantId, r.Id });
    }
}

internal sealed class EmployeeLocationConfig : IEntityTypeConfiguration<EmployeeLocationAssignment>
{
    public void Configure(EntityTypeBuilder<EmployeeLocationAssignment> e)
    {
        e.HasKey(x => new { x.EmployeeId, x.LocationId });
        e.HasIndex(x => new { x.TenantId, x.LocationId });
        e.HasOne(x => x.Location).WithMany().HasForeignKey(x => new { x.TenantId, x.LocationId }).HasPrincipalKey(l => new { l.TenantId, l.Id });
    }
}

internal sealed class AvailabilityConfig : IEntityTypeConfiguration<EmployeeAvailability>
{
    public void Configure(EntityTypeBuilder<EmployeeAvailability> e)
    {
        e.Property(x => x.Note).HasMaxLength(200);
        e.HasIndex(x => new { x.TenantId, x.EmployeeId, x.ValidFrom });
        e.HasOne<Employee>().WithMany().HasForeignKey(x => new { x.TenantId, x.EmployeeId }).HasPrincipalKey(x => new { x.TenantId, x.Id });
    }
}

internal sealed class AvailabilityExceptionConfig : IEntityTypeConfiguration<AvailabilityException>
{
    public void Configure(EntityTypeBuilder<AvailabilityException> e)
    {
        e.Property(x => x.Note).HasMaxLength(200);
        e.HasIndex(x => new { x.TenantId, x.EmployeeId, x.Date });
        e.HasOne<Employee>().WithMany().HasForeignKey(x => new { x.TenantId, x.EmployeeId }).HasPrincipalKey(x => new { x.TenantId, x.Id });
    }
}

internal sealed class ShiftConfig : IEntityTypeConfiguration<Shift>
{
    public void Configure(EntityTypeBuilder<Shift> e)
    {
        e.HasTenantKey();
        e.Property(x => x.Notes).HasMaxLength(500);
        e.Ignore(x => x.PaidHours);
        e.HasIndex(x => new { x.TenantId, x.LocationId, x.LocalDate });
        e.HasIndex(x => new { x.TenantId, x.EmployeeId, x.StartUtc });
        e.HasOne(x => x.Location).WithMany().HasForeignKey(x => new { x.TenantId, x.LocationId }).HasPrincipalKey(l => new { l.TenantId, l.Id });
        e.HasOne(x => x.Employee).WithMany().HasForeignKey(x => new { x.TenantId, x.EmployeeId }).HasPrincipalKey(l => new { l.TenantId, l.Id });
        e.HasOne(x => x.JobRole).WithMany().HasForeignKey(x => new { x.TenantId, x.JobRoleId }).HasPrincipalKey(l => new { l.TenantId, l.Id });
        e.ToTable(t => t.HasCheckConstraint("CK_Shifts_Interval", "[EndUtc] > [StartUtc] AND [BreakMinutes] >= 0"));
    }
}

internal sealed class ShiftPublicationConfig : IEntityTypeConfiguration<ShiftPublication>
{
    public void Configure(EntityTypeBuilder<ShiftPublication> e)
    {
        e.HasIndex(x => new { x.TenantId, x.LocationId, x.WeekStart });
        e.HasOne<RestaurantLocation>().WithMany().HasForeignKey(x => new { x.TenantId, x.LocationId }).HasPrincipalKey(l => new { l.TenantId, l.Id });
    }
}

internal sealed class LeaveConfig : IEntityTypeConfiguration<LeaveRequest>
{
    public void Configure(EntityTypeBuilder<LeaveRequest> e)
    {
        e.Property(x => x.Note).HasMaxLength(500);
        e.Property(x => x.DecisionReason).HasMaxLength(500);
        e.Ignore(x => x.Days);
        e.HasIndex(x => new { x.TenantId, x.EmployeeId, x.StartDate });
        e.HasIndex(x => new { x.TenantId, x.Status });
        e.HasOne(x => x.Employee).WithMany().HasForeignKey(x => new { x.TenantId, x.EmployeeId }).HasPrincipalKey(l => new { l.TenantId, l.Id });
        e.ToTable(t => t.HasCheckConstraint("CK_LeaveRequests_Range", "[EndDate] >= [StartDate]"));
    }
}

internal sealed class SwapConfig : IEntityTypeConfiguration<ShiftSwapRequest>
{
    public void Configure(EntityTypeBuilder<ShiftSwapRequest> e)
    {
        e.Property(x => x.Message).HasMaxLength(300);
        e.Property(x => x.DecisionReason).HasMaxLength(500);
        e.Ignore(x => x.IsOpen);
        e.HasIndex(x => new { x.TenantId, x.ShiftId, x.Status });
        e.HasIndex(x => new { x.TenantId, x.Status });
        e.HasOne(x => x.Shift).WithMany().HasForeignKey(x => new { x.TenantId, x.ShiftId }).HasPrincipalKey(s => new { s.TenantId, s.Id });
        e.HasOne(x => x.Requester).WithMany().HasForeignKey(x => new { x.TenantId, x.RequesterEmployeeId }).HasPrincipalKey(s => new { s.TenantId, s.Id });
        e.HasOne(x => x.Target).WithMany().HasForeignKey(x => new { x.TenantId, x.TargetEmployeeId }).HasPrincipalKey(s => new { s.TenantId, s.Id });
        e.HasOne(x => x.AcceptedBy).WithMany().HasForeignKey(x => new { x.TenantId, x.AcceptedByEmployeeId }).HasPrincipalKey(s => new { s.TenantId, s.Id });
    }
}

internal sealed class NotificationConfig : IEntityTypeConfiguration<Notification>
{
    public void Configure(EntityTypeBuilder<Notification> e)
    {
        e.Property(x => x.Type).HasMaxLength(40);
        e.Property(x => x.Title).HasMaxLength(200);
        e.Property(x => x.Body).HasMaxLength(1000);
        e.Property(x => x.Link).HasMaxLength(300);
        e.Property(x => x.DedupKey).HasMaxLength(200);
        e.HasIndex(x => new { x.TenantId, x.UserId, x.ReadAt, x.CreatedAt });
        e.HasIndex(x => x.DedupKey).IsUnique().HasFilter("[DedupKey] IS NOT NULL");
        e.HasOne<Tenant>().WithMany().HasForeignKey(x => x.TenantId);
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UserId);
    }
}

internal sealed class PushDeviceConfig : IEntityTypeConfiguration<PushDevice>
{
    public void Configure(EntityTypeBuilder<PushDevice> e)
    {
        e.Property(x => x.Token).HasMaxLength(300).IsRequired();
        e.Property(x => x.Platform).HasMaxLength(10);
        e.HasIndex(x => x.Token).IsUnique();
        e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UserId);
    }
}

internal sealed class PlanConfig : IEntityTypeConfiguration<SubscriptionPlan>
{
    public void Configure(EntityTypeBuilder<SubscriptionPlan> e)
    {
        e.HasKey(x => x.Code);
        e.Property(x => x.Code).HasMaxLength(30);
        e.Property(x => x.Name).HasMaxLength(60);
        e.Property(x => x.MonthlyPriceEur).HasPrecision(10, 2);
        // Initial pricing hypotheses (see docs/ARCHITECTURE.md); change via migration or admin tooling.
        e.HasData(
            new SubscriptionPlan { Code = "starter", Name = "Starter", MonthlyPriceEur = 19m, MaxLocations = 1, MaxActiveEmployees = 5, Features = PlanFeatures.None, SortOrder = 1 },
            new SubscriptionPlan
            {
                Code = "team", Name = "Team", MonthlyPriceEur = 39m, MaxLocations = 1, MaxActiveEmployees = 15, SortOrder = 2,
                Features = PlanFeatures.ShiftSwaps | PlanFeatures.Availability | PlanFeatures.Reports | PlanFeatures.EmailNotifications
            },
            new SubscriptionPlan
            {
                Code = "business", Name = "Business", MonthlyPriceEur = 79m, MaxLocations = 5, MaxActiveEmployees = 40, SortOrder = 3,
                Features = PlanFeatures.ShiftSwaps | PlanFeatures.Availability | PlanFeatures.Reports | PlanFeatures.EmailNotifications
                           | PlanFeatures.AdvancedPermissions | PlanFeatures.MultipleLocations
            });
    }
}

internal sealed class SubscriptionConfig : IEntityTypeConfiguration<Subscription>
{
    public void Configure(EntityTypeBuilder<Subscription> e)
    {
        e.HasIndex(x => x.TenantId).IsUnique();
        e.Property(x => x.PlanCode).HasMaxLength(30);
        e.Property(x => x.ExternalCustomerId).HasMaxLength(100);
        e.HasOne(x => x.Plan).WithMany().HasForeignKey(x => x.PlanCode);
    }
}

internal sealed class AuditLogConfig : IEntityTypeConfiguration<AuditLog>
{
    public void Configure(EntityTypeBuilder<AuditLog> e)
    {
        e.Property(x => x.Action).HasMaxLength(80);
        e.Property(x => x.EntityType).HasMaxLength(40);
        e.Property(x => x.IpAddress).HasMaxLength(64);
        e.HasIndex(x => new { x.TenantId, x.CreatedAt });
        e.HasIndex(x => new { x.TenantId, x.EntityType, x.EntityId });
    }
}

internal sealed class OutboxConfig : IEntityTypeConfiguration<OutboxMessage>
{
    public void Configure(EntityTypeBuilder<OutboxMessage> e)
    {
        e.Property(x => x.Type).HasMaxLength(60);
        e.Property(x => x.LastError).HasMaxLength(1000);
        e.HasIndex(x => new { x.ProcessedAt, x.NextAttemptAt });
    }
}
