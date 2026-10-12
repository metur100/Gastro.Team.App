using GastroTeam.Application.Common;
using GastroTeam.Application.Features.Scheduling;
using GastroTeam.Domain.Entities;
using GastroTeam.Domain.Scheduling;
using Microsoft.EntityFrameworkCore;

namespace GastroTeam.Application.Features.Dashboard;

public sealed record DashboardSummaryDto(
    DateOnly Today, int EmployeesWorkingToday, int ShiftsToday, int UnassignedShifts, int PendingLeaveRequests,
    int PendingSwapRequests, double ScheduledHoursThisWeek, int ActiveEmployees, bool HasAnyShifts);

public sealed record ActionItemDto(string Kind, string Severity, string Message, string Link, int Count);

public sealed record EmployeeOverviewDto(
    ShiftDto? NextShift, IReadOnlyList<ShiftDto> UpcomingShifts, double ScheduledHoursThisWeek, decimal? ContractHoursPerWeek,
    int PendingLeaveRequests, int OpenSwapOffers, int UnreadNotifications);

public sealed class DashboardService(IAppDbContext db, Access access, IClock clock, ShiftService shifts)
{
    private async Task<(IReadOnlyList<Guid> Locations, TimeZoneInfo Zone)> ScopeAsync(Guid? locationId, CancellationToken ct)
    {
        access.RequireManager();
        var managed = access.Context.ManagedLocationIds;
        if (locationId is { } id)
        {
            if (!managed.Contains(id)) throw new ForbiddenException("Sie haben keinen Zugriff auf diesen Standort.");
            var tz = await db.Locations.Where(l => l.Id == id).Select(l => l.TimeZoneId).SingleAsync(ct);
            return ([id], ZonedTime.Find(tz));
        }
        var tenantTz = await db.Tenants.Where(t => t.Id == access.TenantId).Select(t => t.DefaultTimeZone).SingleAsync(ct);
        return (managed.ToList(), ZonedTime.Find(tenantTz));
    }

    public async Task<DashboardSummaryDto> SummaryAsync(Guid? locationId, CancellationToken ct)
    {
        var (locs, zone) = await ScopeAsync(locationId, ct);
        var today = ZonedTime.Today(zone, clock.UtcNow);
        var weekStart = ZonedTime.WeekStart(today);
        var weekEnd = weekStart.AddDays(6);
        var shiftScope = db.Shifts.Where(s => locs.Contains(s.LocationId) && s.Status != ShiftStatus.Cancelled);

        var todays = await shiftScope.Where(s => s.LocalDate == today).Select(s => new { s.EmployeeId }).ToListAsync(ct);
        var unassigned = await shiftScope.CountAsync(s => s.EmployeeId == null && s.LocalDate >= today, ct);
        var weekShifts = await shiftScope.Where(s => s.LocalDate >= weekStart && s.LocalDate <= weekEnd)
            .Select(s => new { s.StartUtc, s.EndUtc, s.BreakMinutes }).ToListAsync(ct);
        var hours = weekShifts.Sum(s => Math.Max(0, (s.EndUtc - s.StartUtc).TotalMinutes - s.BreakMinutes) / 60d);
        var pendingLeave = access.Has(ManagerPermissions.ApproveLeave)
            ? await db.LeaveRequests.CountAsync(l => l.Status == LeaveStatus.Pending && l.Employee!.Locations.Any(x => locs.Contains(x.LocationId)), ct)
            : 0;
        var pendingSwaps = access.Has(ManagerPermissions.ManageSwaps)
            ? await db.ShiftSwaps.CountAsync(s => (s.Status == SwapStatus.Pending || s.Status == SwapStatus.AwaitingApproval) && locs.Contains(s.Shift!.LocationId), ct)
            : 0;
        var activeEmployees = await db.Employees.CountAsync(e => (e.Status == EmployeeStatus.Active || e.Status == EmployeeStatus.Invited)
                                                                 && e.Locations.Any(l => locs.Contains(l.LocationId)), ct);
        var hasAny = await shiftScope.AnyAsync(ct);

        return new DashboardSummaryDto(today, todays.Where(s => s.EmployeeId != null).Select(s => s.EmployeeId).Distinct().Count(),
            todays.Count, unassigned, pendingLeave, pendingSwaps, Math.Round(hours, 2), activeEmployees, hasAny);
    }

    public async Task<IReadOnlyList<ShiftDto>> TodayAsync(Guid? locationId, CancellationToken ct)
    {
        var (locs, zone) = await ScopeAsync(locationId, ct);
        var today = ZonedTime.Today(zone, clock.UtcNow);
        var list = await db.Shifts.Include(s => s.Employee).Include(s => s.JobRole).Include(s => s.Location)
            .Where(s => locs.Contains(s.LocationId) && s.LocalDate == today && s.Status != ShiftStatus.Cancelled)
            .OrderBy(s => s.StartUtc).AsSplitQuery().ToListAsync(ct);
        return await shifts.MapAsync(list, ct);
    }

    public async Task<IReadOnlyList<ActionItemDto>> ActionItemsAsync(Guid? locationId, CancellationToken ct)
    {
        var (locs, zone) = await ScopeAsync(locationId, ct);
        var today = ZonedTime.Today(zone, clock.UtcNow);
        var items = new List<ActionItemDto>();

        var unassigned = await db.Shifts.CountAsync(s => locs.Contains(s.LocationId) && s.Status != ShiftStatus.Cancelled
                                                         && s.EmployeeId == null && s.LocalDate >= today && s.LocalDate <= today.AddDays(13), ct);
        if (unassigned > 0)
            items.Add(new("unassigned_shifts", "warning", unassigned == 1 ? "1 Schicht ist noch unbesetzt." : $"{unassigned} Schichten sind noch unbesetzt.", "/schichtplan?unbesetzt=1", unassigned));

        if (access.Has(ManagerPermissions.ApproveLeave))
        {
            var pending = await db.LeaveRequests.CountAsync(l => l.Status == LeaveStatus.Pending && l.Employee!.Locations.Any(x => locs.Contains(x.LocationId)), ct);
            if (pending > 0)
                items.Add(new("pending_leave", "info", pending == 1 ? "1 Urlaubsantrag wartet auf Freigabe." : $"{pending} Urlaubsanträge warten auf Freigabe.", "/urlaub?status=Pending", pending));
        }

        if (access.Has(ManagerPermissions.ManageSwaps))
        {
            var swaps = await db.ShiftSwaps.Include(s => s.Requester).Include(s => s.AcceptedBy)
                .Where(s => s.Status == SwapStatus.AwaitingApproval && locs.Contains(s.Shift!.LocationId))
                .OrderBy(s => s.CreatedAt).Take(3).ToListAsync(ct);
            foreach (var s in swaps)
                items.Add(new("swap_approval", "info", $"{s.Requester!.FirstName} hat einen Schichttausch mit {s.AcceptedBy!.FirstName} angefragt.", "/schichttausch", 1));
        }

        // Next week not (fully) published yet?
        var nextWeek = ZonedTime.WeekStart(today).AddDays(7);
        foreach (var loc in await db.Locations.Where(l => locs.Contains(l.Id) && l.IsActive).Select(l => new { l.Id, l.Name }).ToListAsync(ct))
        {
            var week = await db.Shifts.Where(s => s.LocationId == loc.Id && s.LocalDate >= nextWeek && s.LocalDate <= nextWeek.AddDays(6) && s.Status != ShiftStatus.Cancelled)
                .GroupBy(s => s.Status).Select(g => new { g.Key, Count = g.Count() }).ToListAsync(ct);
            var drafts = week.Where(w => w.Key == ShiftStatus.Draft).Sum(w => w.Count);
            var total = week.Sum(w => w.Count);
            var prefix = locs.Count > 1 ? $"{loc.Name}: " : "";
            var link = $"/schichtplan?standort={loc.Id}&woche={nextWeek:yyyy-MM-dd}";
            if (total == 0)
                items.Add(new("next_week_empty", "warning", $"{prefix}Für nächste Woche sind noch keine Schichten geplant.", link, 0));
            else if (drafts > 0)
                items.Add(new("next_week_unpublished", "warning", $"{prefix}Die Schichtplanung für nächste Woche ist noch nicht veröffentlicht.", link, drafts));
        }

        var invites = await db.Employees.CountAsync(e => e.Status == EmployeeStatus.Invited && e.Locations.Any(l => locs.Contains(l.LocationId)), ct);
        if (invites > 0)
            items.Add(new("pending_invites", "info", invites == 1 ? "1 Einladung wurde noch nicht angenommen." : $"{invites} Einladungen wurden noch nicht angenommen.", "/mitarbeiter?status=Invited", invites));
        return items;
    }

    public async Task<EmployeeOverviewDto> EmployeeOverviewAsync(CancellationToken ct)
    {
        var employeeId = access.RequireEmployee();
        var userId = access.UserId;
        var now = clock.UtcNow;
        var employee = await db.Employees.SingleAsync(e => e.Id == employeeId, ct);
        var tenantTz = await db.Tenants.Where(t => t.Id == access.TenantId).Select(t => t.DefaultTimeZone).SingleAsync(ct);
        var zone = ZonedTime.Find(tenantTz);
        var today = ZonedTime.Today(zone, now);
        var weekStart = ZonedTime.WeekStart(today);
        var upcoming = await db.Shifts.Include(s => s.Employee).Include(s => s.JobRole).Include(s => s.Location)
            .Where(s => s.EmployeeId == employeeId && s.Status == ShiftStatus.Published && s.EndUtc > now)
            .OrderBy(s => s.StartUtc).Take(10).AsSplitQuery().ToListAsync(ct);
        var weekShifts = await db.Shifts.Where(s => s.EmployeeId == employeeId && s.Status == ShiftStatus.Published
                                                    && s.LocalDate >= weekStart && s.LocalDate <= weekStart.AddDays(6))
            .Select(s => new { s.StartUtc, s.EndUtc, s.BreakMinutes }).ToListAsync(ct);
        var hours = weekShifts.Sum(s => Math.Max(0, (s.EndUtc - s.StartUtc).TotalMinutes - s.BreakMinutes) / 60d);
        var pendingLeave = await db.LeaveRequests.CountAsync(l => l.EmployeeId == employeeId && l.Status == LeaveStatus.Pending, ct);
        var locs = access.Context.EmployeeLocationIds;
        var openOffers = await db.ShiftSwaps.CountAsync(s => s.Status == SwapStatus.Pending && s.RequesterEmployeeId != employeeId
                                                             && (s.TargetEmployeeId == employeeId || (s.TargetEmployeeId == null && locs.Contains(s.Shift!.LocationId)))
                                                             && s.Shift!.StartUtc > now, ct);
        var unread = await db.Notifications.CountAsync(n => n.UserId == userId && n.ReadAt == null, ct);
        var mapped = await shifts.MapAsync(upcoming, ct);
        return new EmployeeOverviewDto(mapped.FirstOrDefault(), mapped, Math.Round(hours, 2), employee.ContractHoursPerWeek, pendingLeave, openOffers, unread);
    }
}
