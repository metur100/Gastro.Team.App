using GastroTeam.Application.Common;
using GastroTeam.Application.Localization;
using GastroTeam.Domain.Entities;
using GastroTeam.Domain.Scheduling;
using Microsoft.EntityFrameworkCore;

namespace GastroTeam.Application.Features.Scheduling;

/// <summary>Loads everything the pure <see cref="ScheduleValidator"/> needs for a set of shifts.</summary>
public sealed class ScheduleValidationBuilder(IAppDbContext db)
{
    private readonly Dictionary<Guid, TimeZoneInfo> _zones = new();

    public async Task<TimeZoneInfo> ZoneForAsync(Guid locationId, CancellationToken ct)
    {
        if (_zones.TryGetValue(locationId, out var z)) return z;
        var id = await db.Locations.Where(l => l.Id == locationId).Select(l => l.TimeZoneId).SingleAsync(ct);
        return _zones[locationId] = ZonedTime.Find(id);
    }

    public async Task<ShiftSlot> ToSlotAsync(Shift s, CancellationToken ct)
    {
        var zone = await ZoneForAsync(s.LocationId, ct);
        return new ShiftSlot(s.Id, s.LocationId, s.EmployeeId, s.StartUtc, s.EndUtc,
            ZonedTime.ToLocal(s.StartUtc, zone), ZonedTime.ToLocal(s.EndUtc, zone), s.BreakMinutes, s.Status);
    }

    public async Task<IReadOnlyList<ScheduleIssue>> ValidateAsync(RestaurantLocation location, IReadOnlyList<Shift> shifts, DateOnly? weekStart, CancellationToken ct)
    {
        var settings = await db.TenantSettings.SingleAsync(ct);
        var slots = new List<ShiftSlot>();
        foreach (var s in shifts) slots.Add(await ToSlotAsync(s, ct));

        var employeeIds = shifts.Where(s => s.EmployeeId is not null).Select(s => s.EmployeeId!.Value).Distinct().ToList();
        var from = weekStart ?? (shifts.Count == 0 ? DateOnly.FromDateTime(DateTime.UtcNow) : shifts.Min(s => s.LocalDate));
        var to = weekStart?.AddDays(6) ?? (shifts.Count == 0 ? from : shifts.Max(s => s.LocalDate));
        // Context window: one day around the range for rest periods; whole ISO weeks for weekly totals.
        var ctxFrom = ZonedTime.WeekStart(from).AddDays(-1);
        var ctxTo = ZonedTime.WeekStart(to).AddDays(7);
        var fromUtc = ctxFrom.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc).AddDays(-1);
        var toUtc = ctxTo.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc).AddDays(1);

        var shiftIds = shifts.Select(s => s.Id).ToList();
        var contextShifts = await db.Shifts
            .Where(s => s.EmployeeId != null && employeeIds.Contains(s.EmployeeId.Value) && s.Status != ShiftStatus.Cancelled
                        && s.StartUtc < toUtc && s.EndUtc > fromUtc && !shiftIds.Contains(s.Id))
            .ToListAsync(ct);
        var contextSlots = new List<ShiftSlot>();
        foreach (var s in contextShifts) contextSlots.Add(await ToSlotAsync(s, ct));

        var employees = await db.Employees.Where(e => employeeIds.Contains(e.Id))
            .Select(e => new { e.Id, e.FirstName, e.LastName, e.Status, e.ContractHoursPerWeek, Locations = e.Locations.Select(l => l.LocationId).ToList() })
            .ToListAsync(ct);

        var availability = await db.Availability
            .Where(a => employeeIds.Contains(a.EmployeeId) && a.ValidFrom <= to && (a.ValidTo == null || a.ValidTo >= from))
            .ToListAsync(ct);
        var exceptions = await db.AvailabilityExceptions
            .Where(a => employeeIds.Contains(a.EmployeeId) && a.Date >= from.AddDays(-1) && a.Date <= to.AddDays(1))
            .ToListAsync(ct);
        var leave = await db.LeaveRequests
            .Where(l => employeeIds.Contains(l.EmployeeId) && (l.Status == LeaveStatus.Approved || l.Status == LeaveStatus.Pending)
                        && l.StartDate <= to.AddDays(1) && l.EndDate >= from.AddDays(-1))
            .ToListAsync(ct);
        var opening = await db.OpeningHours.Where(o => o.LocationId == location.Id).ToListAsync(ct);

        var input = new ScheduleValidationInput
        {
            Shifts = slots,
            ContextShifts = contextSlots,
            Employees = employees.ToDictionary(e => e.Id, e => new EmployeeSnapshot(e.Id, $"{e.FirstName} {e.LastName}", e.Status, e.ContractHoursPerWeek, e.Locations.ToHashSet())),
            // A weekly pattern is replaced as a whole; compare against the newest version effective in the range.
            Availability = availability.GroupBy(a => a.EmployeeId)
                .SelectMany(g => g.Where(a => a.ValidFrom == g.Max(x => x.ValidFrom)))
                .Select(a => new AvailabilityWindow(a.EmployeeId, a.DayOfWeek, a.StartTime, a.EndTime, a.Kind)).ToList(),
            UnavailableDates = exceptions.Select(a => new UnavailableDate(a.EmployeeId, a.Date, a.StartTime, a.EndTime)).ToList(),
            Leave = leave.Select(l => new LeavePeriod(l.EmployeeId, l.StartDate, l.EndDate, l.Status)).ToList(),
            OpeningHours = opening.Select(o => new OpeningWindow(o.DayOfWeek, o.IsClosed, o.OpensAt, o.ClosesAt)).ToList(),
            Policy = new SchedulePolicy(settings.UnassignedShiftsBlockPublish, settings.MaxShiftHours, settings.MaxDailyHours,
                settings.MaxWeeklyHours, settings.MinRestHours, settings.CheckBreakRules, location.MinStaffPerDay, location.PrepBufferMinutes),
            WeekStart = weekStart
        };
        return ScheduleValidator.Validate(input);
    }

    public static IssueDto ToDto(ScheduleIssue i) =>
        new(i.Severity.ToString(), i.Code, Messages.Describe(i), i.ShiftId, i.EmployeeId, i.Date);
}
