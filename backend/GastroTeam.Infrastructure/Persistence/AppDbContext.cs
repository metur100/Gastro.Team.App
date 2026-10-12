using System.Linq.Expressions;
using GastroTeam.Application.Common;
using GastroTeam.Domain.Common;
using GastroTeam.Domain.Entities;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace GastroTeam.Infrastructure.Persistence;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options, RequestContext? requestContext = null)
    : IdentityDbContext<ApplicationUser, IdentityRole<Guid>, Guid>(options), IAppDbContext, IDataProtectionKeyContext
{
    /// <summary>
    /// Tenant used by the global query filters. Guid.Empty (no tenant resolved) matches no rows, so a missing
    /// tenant context fails closed. Cross-tenant code paths must opt out explicitly with IgnoreQueryFilters().
    /// </summary>
    public Guid FilterTenantId => requestContext?.FilterTenantId ?? Guid.Empty;

    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<TenantSettings> TenantSettings => Set<TenantSettings>();
    public DbSet<TenantMembership> Memberships => Set<TenantMembership>();
    public DbSet<MembershipLocation> MembershipLocations => Set<MembershipLocation>();
    public DbSet<Invitation> Invitations => Set<Invitation>();
    public DbSet<RestaurantLocation> Locations => Set<RestaurantLocation>();
    public DbSet<LocationOpeningHour> OpeningHours => Set<LocationOpeningHour>();
    public DbSet<JobRole> JobRoles => Set<JobRole>();
    public DbSet<Employee> Employees => Set<Employee>();
    public DbSet<EmployeeLocationAssignment> EmployeeLocations => Set<EmployeeLocationAssignment>();
    public DbSet<EmployeeAvailability> Availability => Set<EmployeeAvailability>();
    public DbSet<AvailabilityException> AvailabilityExceptions => Set<AvailabilityException>();
    public DbSet<Shift> Shifts => Set<Shift>();
    public DbSet<ShiftPublication> ShiftPublications => Set<ShiftPublication>();
    public DbSet<LeaveRequest> LeaveRequests => Set<LeaveRequest>();
    public DbSet<ShiftSwapRequest> ShiftSwaps => Set<ShiftSwapRequest>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<PushDevice> PushDevices => Set<PushDevice>();
    public DbSet<SubscriptionPlan> SubscriptionPlans => Set<SubscriptionPlan>();
    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);
        b.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);

        foreach (var entity in b.Model.GetEntityTypes())
        {
            var clr = entity.ClrType;
            if (typeof(ITenantOwned).IsAssignableFrom(clr) && entity.BaseType is null)
                b.Entity(clr).HasQueryFilter(TenantFilter(clr));

            if (typeof(IVersioned).IsAssignableFrom(clr))
                b.Entity(clr).Property(nameof(IVersioned.RowVersion)).IsRowVersion();

            // Restrict deletes globally; SQL Server forbids multiple cascade paths and history must be kept.
            foreach (var fk in entity.GetForeignKeys().Where(fk => !fk.IsOwnership && fk.DeleteBehavior == DeleteBehavior.Cascade))
                fk.DeleteBehavior = DeleteBehavior.Restrict;

            foreach (var p in entity.GetProperties())
            {
                if (p.ClrType == typeof(DateTime)) p.SetValueConverter(UtcConverter);
                else if (p.ClrType == typeof(DateTime?)) p.SetValueConverter(NullableUtcConverter);
            }
        }

        // Identity tables keep cascade for their own children (claims, logins, tokens).
        foreach (var t in new[] { typeof(IdentityUserClaim<Guid>), typeof(IdentityUserLogin<Guid>), typeof(IdentityUserToken<Guid>), typeof(IdentityUserRole<Guid>), typeof(IdentityRoleClaim<Guid>) })
            foreach (var fk in b.Model.FindEntityType(t)!.GetForeignKeys())
                fk.DeleteBehavior = DeleteBehavior.Cascade;

        // Child collections that are replaced through navigation edits are deleted client-side.
        b.Entity<Employee>().HasMany(e => e.Locations).WithOne().HasForeignKey(a => new { a.TenantId, a.EmployeeId })
            .HasPrincipalKey(e => new { e.TenantId, e.Id }).OnDelete(DeleteBehavior.ClientCascade);
        b.Entity<TenantMembership>().HasMany(m => m.Locations).WithOne().HasForeignKey(l => new { l.TenantId, l.MembershipId })
            .HasPrincipalKey(m => new { m.TenantId, m.Id }).OnDelete(DeleteBehavior.ClientCascade);
        b.Entity<RestaurantLocation>().HasMany(l => l.OpeningHours).WithOne().HasForeignKey(o => new { o.TenantId, o.LocationId })
            .HasPrincipalKey(l => new { l.TenantId, l.Id }).OnDelete(DeleteBehavior.ClientCascade);
    }

    private LambdaExpression TenantFilter(Type clr)
    {
        var param = Expression.Parameter(clr, "e");
        var body = Expression.Equal(
            Expression.Property(param, nameof(ITenantOwned.TenantId)),
            Expression.Property(Expression.Constant(this), nameof(FilterTenantId)));
        return Expression.Lambda(body, param);
    }

    private static readonly ValueConverter<DateTime, DateTime> UtcConverter =
        new(v => v.Kind == DateTimeKind.Local ? v.ToUniversalTime() : v, v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

    private static readonly ValueConverter<DateTime?, DateTime?> NullableUtcConverter =
        new(v => v.HasValue && v.Value.Kind == DateTimeKind.Local ? v.Value.ToUniversalTime() : v,
            v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : v);
}

internal static class TenantKeys
{
    /// <summary>Alternate key (TenantId, Id) so dependents can reference it with a tenant-consistent composite FK.</summary>
    public static void HasTenantKey<T>(this EntityTypeBuilder<T> e) where T : Entity, ITenantOwned =>
        e.HasAlternateKey(x => new { x.TenantId, x.Id });
}
