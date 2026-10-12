using GastroTeam.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace GastroTeam.Application.Common;

/// <summary>Resolves the tenant context for an authenticated user from the database.</summary>
public sealed class TenantResolver(IAppDbContext db, RequestContext ctx)
{
    /// <returns>false if the requested tenant is not accessible for the user.</returns>
    public async Task<bool> ResolveAsync(Guid userId, Guid? requestedTenantId, CancellationToken ct)
    {
        var memberships = await db.Memberships.IgnoreQueryFilters()
            .Where(m => m.UserId == userId && m.IsActive)
            .OrderBy(m => m.CreatedAt)
            .Select(m => new { m.Id, m.TenantId, m.Role, m.Permissions })
            .ToListAsync(ct);

        var membership = requestedTenantId is { } requested
            ? memberships.FirstOrDefault(m => m.TenantId == requested)
            : memberships.FirstOrDefault();

        if (membership is null) return requestedTenantId is null;

        var tenant = await db.Tenants.IgnoreQueryFilters()
            .Where(t => t.Id == membership.TenantId)
            .Select(t => new { t.Status })
            .SingleAsync(ct);

        var subscription = await db.Subscriptions.IgnoreQueryFilters()
            .Include(s => s.Plan)
            .Where(s => s.TenantId == membership.TenantId)
            .SingleOrDefaultAsync(ct);

        HashSet<Guid> managed;
        if (membership.Role == MembershipRole.Owner)
            managed = (await db.Locations.IgnoreQueryFilters()
                .Where(l => l.TenantId == membership.TenantId)
                .Select(l => l.Id).ToListAsync(ct)).ToHashSet();
        else if (membership.Role == MembershipRole.Manager)
            managed = (await db.MembershipLocations.IgnoreQueryFilters()
                .Where(ml => ml.MembershipId == membership.Id && ml.TenantId == membership.TenantId)
                .Select(ml => ml.LocationId).ToListAsync(ct)).ToHashSet();
        else
            managed = [];

        var employee = await db.Employees.IgnoreQueryFilters()
            .Where(e => e.TenantId == membership.TenantId && e.UserId == userId && e.Status != EmployeeStatus.Archived)
            .Select(e => new { e.Id, Locations = e.Locations.Select(l => l.LocationId).ToList() })
            .FirstOrDefaultAsync(ct);

        ctx.TenantId = membership.TenantId;
        ctx.MembershipId = membership.Id;
        ctx.Role = membership.Role;
        ctx.Permissions = membership.Permissions;
        ctx.ManagedLocationIds = managed;
        ctx.EmployeeId = employee?.Id;
        ctx.EmployeeLocationIds = employee?.Locations.ToHashSet() ?? [];
        ctx.TenantStatus = tenant.Status;
        ctx.Plan = subscription?.Plan;
        ctx.SubscriptionStatus = subscription?.Status ?? SubscriptionStatus.Suspended;
        ctx.TrialEndsAt = subscription?.TrialEndsAt;
        return true;
    }
}
