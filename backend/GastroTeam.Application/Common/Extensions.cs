using GastroTeam.Domain.Common;
using Microsoft.EntityFrameworkCore;

namespace GastroTeam.Application.Common;

public static class QueryExtensions
{
    public static async Task<PagedResult<T>> ToPagedAsync<T>(this IQueryable<T> query, int page, int pageSize, CancellationToken ct)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var total = await query.CountAsync(ct);
        var items = await query.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        return new PagedResult<T>(items, page, pageSize, total);
    }

    public static string ToVersion(this byte[] rowVersion) => Convert.ToBase64String(rowVersion);

    /// <summary>Sets the concurrency token the client loaded, so a stale update raises a conflict.</summary>
    public static void ApplyClientVersion<T>(this IAppDbContext db, T entity, string? version) where T : class, IVersioned
    {
        if (string.IsNullOrWhiteSpace(version))
            throw RequestValidationException.For("version", "Die Versionsangabe fehlt.");
        byte[] bytes;
        try { bytes = Convert.FromBase64String(version); }
        catch (FormatException) { throw RequestValidationException.For("version", "Die Versionsangabe ist ungültig."); }
        if (!bytes.AsSpan().SequenceEqual(entity.RowVersion)) throw ConcurrencyErrors.Stale();
        db.Entry(entity).Property(nameof(IVersioned.RowVersion)).OriginalValue = bytes;
    }

    public static string? NullIfBlank(this string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
