using System.Text.Json;
using GastroTeam.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace GastroTeam.Application.Common;

/// <summary>Adds audit entries to the current unit of work (saved together with the business change).</summary>
public sealed class AuditLogger(IAppDbContext db, RequestContext ctx, IClock clock)
{
    public void Log(string action, string entityType, Guid? entityId, object? details = null, Guid? tenantId = null)
    {
        db.AuditLogs.Add(new AuditLog
        {
            TenantId = tenantId ?? ctx.TenantId,
            UserId = ctx.UserId,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            Details = details is null ? null : JsonSerializer.Serialize(details),
            IpAddress = ctx.IpAddress,
            CreatedAt = clock.UtcNow
        });
    }
}

public static class NotificationTypes
{
    public const string Invitation = "invitation";
    public const string SchedulePublished = "schedule_published";
    public const string ScheduleUnpublished = "schedule_unpublished";
    public const string ShiftChanged = "shift_changed";
    public const string ShiftAssigned = "shift_assigned";
    public const string ShiftCancelled = "shift_cancelled";
    public const string LeaveSubmitted = "leave_submitted";
    public const string LeaveDecided = "leave_decided";
    public const string SwapRequested = "swap_requested";
    public const string SwapUpdated = "swap_updated";
    public const string ApprovalRequired = "approval_required";
}

public sealed record OutboxNotificationPayload(Guid NotificationId, Guid UserId, string Title, string Body, string? Link, bool SendEmail);

/// <summary>
/// Creates in-app notifications in the current transaction and enqueues e-mail/push delivery in the
/// outbox. Delivery failures never roll back the business operation.
/// </summary>
public sealed class Notifier(IAppDbContext db, RequestContext ctx, IClock clock)
{
    public void Notify(Guid tenantId, IEnumerable<Guid> userIds, string type, string title, string body, string? link, string? dedupKey = null)
    {
        var now = clock.UtcNow;
        var sendEmail = ctx.Plan?.Features.HasFlag(PlanFeatures.EmailNotifications) ?? false;
        foreach (var userId in userIds.Distinct())
        {
            if (ctx.UserId == userId && type != NotificationTypes.Invitation) continue; // no self-notifications
            var n = new Notification
            {
                TenantId = tenantId,
                UserId = userId,
                Type = type,
                Title = title,
                Body = body,
                Link = link,
                DedupKey = dedupKey is null ? null : $"{dedupKey}:{userId}",
                CreatedAt = now
            };
            db.Notifications.Add(n);
            db.OutboxMessages.Add(new OutboxMessage
            {
                TenantId = tenantId,
                Type = "notification.deliver",
                Payload = JsonSerializer.Serialize(new OutboxNotificationPayload(n.Id, userId, title, body, link, sendEmail)),
                CreatedAt = now,
                NextAttemptAt = now
            });
        }
    }

    /// <summary>User ids of owners and managers who manage the location and hold the permission.</summary>
    public async Task<List<Guid>> ManagersForLocationAsync(Guid tenantId, Guid locationId, ManagerPermissions permission, CancellationToken ct)
    {
        var members = await db.Memberships
            .Where(m => m.TenantId == tenantId && m.IsActive && (m.Role == MembershipRole.Owner || m.Role == MembershipRole.Manager))
            .Select(m => new { m.UserId, m.Role, m.Permissions, Locations = m.Locations.Select(l => l.LocationId).ToList() })
            .ToListAsync(ct);
        return members
            .Where(m => m.Role == MembershipRole.Owner || (m.Permissions.HasFlag(permission) && m.Locations.Contains(locationId)))
            .Select(m => m.UserId)
            .Distinct()
            .ToList();
    }

    public async Task<List<Guid>> ManagersForEmployeeAsync(Guid tenantId, Guid employeeId, ManagerPermissions permission, CancellationToken ct)
    {
        var locationIds = await db.EmployeeLocations.Where(l => l.EmployeeId == employeeId).Select(l => l.LocationId).ToListAsync(ct);
        var result = new HashSet<Guid>();
        foreach (var loc in locationIds)
            result.UnionWith(await ManagersForLocationAsync(tenantId, loc, permission, ct));
        if (locationIds.Count == 0)
            result.UnionWith(await db.Memberships.Where(m => m.TenantId == tenantId && m.IsActive && m.Role == MembershipRole.Owner).Select(m => m.UserId).ToListAsync(ct));
        return result.ToList();
    }
}
