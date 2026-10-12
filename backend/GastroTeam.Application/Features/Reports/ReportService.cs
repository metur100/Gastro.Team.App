using System.Globalization;
using System.Text;
using GastroTeam.Application.Common;
using GastroTeam.Application.Localization;
using GastroTeam.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace GastroTeam.Application.Features.Reports;

public sealed record ReportQuery(DateOnly From, DateOnly To, Guid? LocationId = null, Guid? EmployeeId = null);

public sealed record EmployeeHoursRow(Guid EmployeeId, string EmployeeName, string? JobRole, decimal? ContractHoursPerWeek, int Shifts, double PlannedHours, double PublishedHours);
public sealed record LocationHoursRow(Guid LocationId, string LocationName, int Shifts, int UnassignedShifts, double PlannedHours);
public sealed record StaffingRow(DateOnly Date, Guid LocationId, string LocationName, string JobRole, int Shifts, int Assigned, int Unassigned, double PlannedHours);
public sealed record UnassignedShiftRow(Guid ShiftId, DateOnly Date, string LocationName, string JobRole, string Start, string End, string Status);
public sealed record LeaveRow(string EmployeeName, string Type, DateOnly StartDate, DateOnly EndDate, int Days, string Status);
public sealed record StatusCountRow(string Status, int Count);
public sealed record ShiftChangeRow(DateTime At, string Action, string? UserName, Guid? ShiftId, string? Details);

public sealed record Csv(string FileName, byte[] Content);

/// <summary>
/// Reports on planned (scheduled) hours. These are not verified worked hours.
/// All reports apply the same tenant and location scope as the corresponding screens.
/// </summary>
public sealed class ReportService(IAppDbContext db, Access access)
{
    private const int MaxDays = 366;

    private IReadOnlyList<Guid> Scope(ReportQuery q)
    {
        access.Require(ManagerPermissions.ViewReports);
        access.RequireFeature(PlanFeatures.Reports);
        if (q.To < q.From || q.To.DayNumber - q.From.DayNumber > MaxDays)
            throw RequestValidationException.For("to", "Der Zeitraum darf hÃ¶chstens ein Jahr umfassen.");
        var managed = access.Context.ManagedLocationIds;
        if (q.LocationId is { } id)
        {
            if (!managed.Contains(id)) throw new ForbiddenException("Sie haben keinen Zugriff auf diesen Standort.");
            return [id];
        }
        return managed.ToList();
    }

    private IQueryable<Shift> Shifts(ReportQuery q, IReadOnlyList<Guid> locs)
    {
        var s = db.Shifts.Where(x => locs.Contains(x.LocationId) && x.LocalDate >= q.From && x.LocalDate <= q.To && x.Status != ShiftStatus.Cancelled);
        if (q.EmployeeId is { } e) s = s.Where(x => x.EmployeeId == e);
        return s;
    }

    public async Task<IReadOnlyList<EmployeeHoursRow>> ScheduledHoursAsync(ReportQuery q, CancellationToken ct)
    {
        var locs = Scope(q);
        var rows = await Shifts(q, locs).Where(s => s.EmployeeId != null)
            .Select(s => new { s.EmployeeId, s.StartUtc, s.EndUtc, s.BreakMinutes, s.Status }).ToListAsync(ct);
        var ids = rows.Select(r => r.EmployeeId!.Value).Distinct().ToList();
        var employees = await db.Employees.Include(e => e.JobRole).Where(e => ids.Contains(e.Id)).ToDictionaryAsync(e => e.Id, ct);
        return rows.GroupBy(r => r.EmployeeId!.Value)
            .Select(g =>
            {
                var e = employees[g.Key];
                var planned = g.Sum(x => Math.Max(0, (x.EndUtc - x.StartUtc).TotalMinutes - x.BreakMinutes) / 60d);
                var published = g.Where(x => x.Status == ShiftStatus.Published).Sum(x => Math.Max(0, (x.EndUtc - x.StartUtc).TotalMinutes - x.BreakMinutes) / 60d);
                return new EmployeeHoursRow(e.Id, e.FullName, e.JobRole?.Name, e.ContractHoursPerWeek, g.Count(), Math.Round(planned, 2), Math.Round(published, 2));
            })
            .OrderBy(r => r.EmployeeName).ToList();
    }

    public async Task<IReadOnlyList<LocationHoursRow>> LocationHoursAsync(ReportQuery q, CancellationToken ct)
    {
        var locs = Scope(q);
        var rows = await Shifts(q, locs).Select(s => new { s.LocationId, s.EmployeeId, s.StartUtc, s.EndUtc, s.BreakMinutes }).ToListAsync(ct);
        var names = await db.Locations.Where(l => locs.Contains(l.Id)).ToDictionaryAsync(l => l.Id, l => l.Name, ct);
        return locs.Select(id =>
        {
            var g = rows.Where(r => r.LocationId == id).ToList();
            return new LocationHoursRow(id, names.GetValueOrDefault(id, "?"), g.Count, g.Count(x => x.EmployeeId == null),
                Math.Round(g.Sum(x => Math.Max(0, (x.EndUtc - x.StartUtc).TotalMinutes - x.BreakMinutes) / 60d), 2));
        }).OrderBy(r => r.LocationName).ToList();
    }

    public async Task<IReadOnlyList<StaffingRow>> StaffingAsync(ReportQuery q, CancellationToken ct)
    {
        var locs = Scope(q);
        var rows = await Shifts(q, locs)
            .Select(s => new { s.LocalDate, s.LocationId, Location = s.Location!.Name, Role = s.JobRole!.Name, s.EmployeeId, s.StartUtc, s.EndUtc, s.BreakMinutes })
            .ToListAsync(ct);
        return rows.GroupBy(r => new { r.LocalDate, r.LocationId, r.Location, r.Role })
            .Select(g => new StaffingRow(g.Key.LocalDate, g.Key.LocationId, g.Key.Location, g.Key.Role, g.Count(),
                g.Count(x => x.EmployeeId != null), g.Count(x => x.EmployeeId == null),
                Math.Round(g.Sum(x => Math.Max(0, (x.EndUtc - x.StartUtc).TotalMinutes - x.BreakMinutes) / 60d), 2)))
            .OrderBy(r => r.Date).ThenBy(r => r.LocationName).ThenBy(r => r.JobRole).ToList();
    }

    public async Task<IReadOnlyList<UnassignedShiftRow>> UnassignedAsync(ReportQuery q, CancellationToken ct)
    {
        var locs = Scope(q);
        var shifts = await Shifts(q, locs).Where(s => s.EmployeeId == null).Include(s => s.Location).Include(s => s.JobRole)
            .OrderBy(s => s.StartUtc).ToListAsync(ct);
        return shifts.Select(s =>
        {
            var zone = Domain.Scheduling.ZonedTime.Find(s.Location!.TimeZoneId);
            return new UnassignedShiftRow(s.Id, s.LocalDate, s.Location.Name, s.JobRole!.Name,
                Domain.Scheduling.ZonedTime.ToLocal(s.StartUtc, zone).ToString("HH:mm"), Domain.Scheduling.ZonedTime.ToLocal(s.EndUtc, zone).ToString("HH:mm"),
                s.Status == ShiftStatus.Published ? "VerÃ¶ffentlicht" : "Entwurf");
        }).ToList();
    }

    public async Task<IReadOnlyList<LeaveRow>> LeaveAsync(ReportQuery q, CancellationToken ct)
    {
        var locs = Scope(q);
        var query = db.LeaveRequests.Include(l => l.Employee)
            .Where(l => l.EndDate >= q.From && l.StartDate <= q.To && l.Employee!.Locations.Any(x => locs.Contains(x.LocationId)));
        if (q.EmployeeId is { } e) query = query.Where(l => l.EmployeeId == e);
        var list = await query.OrderBy(l => l.StartDate).ToListAsync(ct);
        return list.Select(l => new LeaveRow(l.Employee!.FullName, LeaveTypeLabel(l.Type), l.StartDate, l.EndDate, l.Days, LeaveStatusLabel(l.Status))).ToList();
    }

    public async Task<IReadOnlyList<StatusCountRow>> EmployeeStatusAsync(ReportQuery q, CancellationToken ct)
    {
        var locs = Scope(q);
        var counts = await db.Employees.Where(e => e.Locations.Any(l => locs.Contains(l.LocationId)))
            .GroupBy(e => e.Status).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct);
        return Enum.GetValues<EmployeeStatus>().Select(s => new StatusCountRow(EmployeeStatusLabel(s), counts.FirstOrDefault(c => c.Key == s)?.Count ?? 0)).ToList();
    }

    public async Task<IReadOnlyList<ShiftChangeRow>> ShiftChangesAsync(ReportQuery q, CancellationToken ct)
    {
        var locs = Scope(q);
        var from = q.From.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var to = q.To.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var tenantId = access.TenantId;
        var shiftIds = db.Shifts.Where(s => locs.Contains(s.LocationId)).Select(s => (Guid?)s.Id);
        var logs = await db.AuditLogs
            .Where(a => a.TenantId == tenantId && a.EntityType == "Shift" && a.CreatedAt >= from && a.CreatedAt < to
                        && (a.Action == "shift.updated" || a.Action == "shift.cancelled" || a.Action == "shift.deleted")
                        && (a.Action == "shift.deleted" || shiftIds.Contains(a.EntityId)))
            .OrderByDescending(a => a.CreatedAt).Take(2000).ToListAsync(ct);
        var userIds = logs.Where(l => l.UserId != null).Select(l => l.UserId!.Value).Distinct().ToList();
        var names = await db.Users.Where(u => userIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.FirstName + " " + u.LastName, ct);
        return logs.Select(l => new ShiftChangeRow(l.CreatedAt, l.Action switch
        {
            "shift.updated" => "GeÃ¤ndert",
            "shift.cancelled" => "Abgesagt",
            "shift.deleted" => "GelÃ¶scht (Entwurf)",
            _ => l.Action
        }, l.UserId is { } u ? names.GetValueOrDefault(u) : null, l.EntityId, l.Details)).ToList();
    }

    // ---------- CSV ----------

    public static Csv ToCsv<T>(string name, ReportQuery q, IReadOnlyList<T> rows, params (string Header, Func<T, object?> Value)[] columns)
    {
        var sb = new StringBuilder();
        sb.AppendLine(string.Join(';', columns.Select(c => Escape(c.Header))));
        foreach (var r in rows)
            sb.AppendLine(string.Join(';', columns.Select(c => Escape(Format(c.Value(r))))));
        // UTF-8 BOM so Excel (de-DE) recognises umlauts; semicolon is the German Excel list separator.
        var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray();
        return new Csv($"gastroteam-{name}-{q.From:yyyy-MM-dd}-{q.To:yyyy-MM-dd}.csv", bytes);
    }

    private static string Format(object? v) => v switch
    {
        null => "",
        DateOnly d => d.ToString("dd.MM.yyyy", Messages.German),
        DateTime dt => dt.ToString("dd.MM.yyyy HH:mm", Messages.German) + " UTC",
        double x => x.ToString("0.##", Messages.German),
        decimal m => m.ToString("0.##", Messages.German),
        _ => Convert.ToString(v, CultureInfo.InvariantCulture) ?? ""
    };

    /// <summary>Quotes fields and neutralises spreadsheet formula injection (=, +, -, @, tab, CR).</summary>
    public static string Escape(string value)
    {
        if (value.Length > 0 && "=+-@\t\r".Contains(value[0])) value = "'" + value;
        var needsQuotes = value.IndexOfAny([';', '"', '\n', '\r', ',']) >= 0 || value.StartsWith('\'');
        return needsQuotes ? "\"" + value.Replace("\"", "\"\"") + "\"" : value;
    }

    public static string LeaveTypeLabel(LeaveType t) => t switch
    {
        LeaveType.Vacation => "Urlaub", LeaveType.Sick => "Krankmeldung", LeaveType.Unpaid => "Unbezahlter Urlaub",
        LeaveType.Training => "Fortbildung", _ => "Sonstiges"
    };

    public static string LeaveStatusLabel(LeaveStatus s) => s switch
    {
        LeaveStatus.Pending => "Offen", LeaveStatus.Approved => "Genehmigt", LeaveStatus.Rejected => "Abgelehnt", _ => "Storniert"
    };

    public static string EmployeeStatusLabel(EmployeeStatus s) => s switch
    {
        EmployeeStatus.Invited => "Eingeladen", EmployeeStatus.Active => "Aktiv", EmployeeStatus.Inactive => "Inaktiv", _ => "Archiviert"
    };
}
