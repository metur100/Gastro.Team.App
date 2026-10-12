using GastroTeam.Application.Common;
using Microsoft.EntityFrameworkCore;

namespace GastroTeam.Application.Features.Notifications;

public sealed record NotificationDto(Guid Id, string Type, string Title, string Body, string? Link, DateTime CreatedAt, DateTime? ReadAt);

public sealed class NotificationQueryService(IAppDbContext db, Access access, IClock clock)
{
    public async Task<PagedResult<NotificationDto>> ListAsync(bool unreadOnly, int page, int pageSize, CancellationToken ct)
    {
        var userId = access.UserId;
        _ = access.TenantId;
        var q = db.Notifications.Where(n => n.UserId == userId);
        if (unreadOnly) q = q.Where(n => n.ReadAt == null);
        return await q.OrderByDescending(n => n.CreatedAt)
            .Select(n => new NotificationDto(n.Id, n.Type, n.Title, n.Body, n.Link, n.CreatedAt, n.ReadAt))
            .ToPagedAsync(page, pageSize, ct);
    }

    public async Task<int> UnreadCountAsync(CancellationToken ct)
    {
        var userId = access.UserId;
        if (access.Context.TenantId is null) return 0;
        return await db.Notifications.CountAsync(n => n.UserId == userId && n.ReadAt == null, ct);
    }

    public async Task MarkReadAsync(Guid id, CancellationToken ct)
    {
        var userId = access.UserId;
        var n = await db.Notifications.SingleOrDefaultAsync(x => x.Id == id && x.UserId == userId, ct) ?? throw new NotFoundException();
        n.ReadAt ??= clock.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    public async Task<int> MarkAllReadAsync(CancellationToken ct)
    {
        var userId = access.UserId;
        _ = access.TenantId;
        var now = clock.UtcNow;
        return await db.Notifications.Where(n => n.UserId == userId && n.ReadAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, now), ct);
    }
}
