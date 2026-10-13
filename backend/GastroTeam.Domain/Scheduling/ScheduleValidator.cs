using GastroTeam.Domain.Entities;

namespace GastroTeam.Domain.Scheduling;

public enum IssueSeverity { Info = 0, Warning = 1, Error = 2 }

/// <summary>A validation finding. Code is stable; Args carry values for the localised message.</summary>
public sealed record ScheduleIssue(
    IssueSeverity Severity,
    string Code,
    Guid? ShiftId = null,
    Guid? EmployeeId = null,
    DateOnly? Date = null,
    IReadOnlyDictionary<string, string>? Args = null);

public sealed record ShiftSlot(
    Guid Id,
    Guid LocationId,
    Guid? EmployeeId,
    DateTime StartUtc,
    DateTime EndUtc,
    DateTime StartLocal,
    DateTime EndLocal,
    int BreakMinutes,
    ShiftStatus Status)
{
    public double DurationHours => (EndUtc - StartUtc).TotalHours;
    public double PaidHours => Math.Max(0, (EndUtc - StartUtc).TotalMinutes - BreakMinutes) / 60d;
    public DateOnly LocalDate => DateOnly.FromDateTime(StartLocal);
}

public sealed record EmployeeSnapshot(
    Guid Id,
    string Name,
    EmployeeStatus Status,
    decimal? ContractHoursPerWeek,
    IReadOnlySet<Guid> LocationIds);

public sealed record AvailabilityWindow(Guid EmployeeId, DayOfWeek Day, TimeOnly Start, TimeOnly End, AvailabilityKind Kind);

public sealed record UnavailableDate(Guid EmployeeId, DateOnly Date, TimeOnly? Start, TimeOnly? End);

public sealed record LeavePeriod(Guid EmployeeId, DateOnly Start, DateOnly End, LeaveStatus Status);

public sealed record OpeningWindow(DayOfWeek Day, bool IsClosed, TimeOnly Opens, TimeOnly Closes);

public sealed record SchedulePolicy(
    bool UnassignedBlocksPublish,
    decimal MaxShiftHours,
    decimal MaxDailyHours,
    decimal MaxWeeklyHours,
    decimal MinRestHours,
    bool CheckBreakRules,
    int MinStaffPerDay,
    int PrepBufferMinutes);

public sealed class ScheduleValidationInput
{
    /// <summary>The shifts being validated (e.g. one location week).</summary>
    public required IReadOnlyList<ShiftSlot> Shifts { get; init; }
    /// <summary>Other shifts of the same employees (other locations / adjacent days) for overlap, rest and hour totals.</summary>
    public IReadOnlyList<ShiftSlot> ContextShifts { get; init; } = [];
    public required IReadOnlyDictionary<Guid, EmployeeSnapshot> Employees { get; init; }
    public IReadOnlyList<AvailabilityWindow> Availability { get; init; } = [];
    public IReadOnlyList<UnavailableDate> UnavailableDates { get; init; } = [];
    public IReadOnlyList<LeavePeriod> Leave { get; init; } = [];
    public IReadOnlyList<OpeningWindow> OpeningHours { get; init; } = [];
    public required SchedulePolicy Policy { get; init; }
    /// <summary>Monday of the validated week (local). Enables weekly totals and coverage checks.</summary>
    public DateOnly? WeekStart { get; init; }
}

/// <summary>
/// Pure, deterministic schedule rule engine. Errors block publishing, warnings require manager
/// confirmation, infos are hints. Labour-law related checks are configurable heuristics and do not
/// constitute legal compliance.
/// </summary>
public static class ScheduleValidator
{
    public static IReadOnlyList<ScheduleIssue> Validate(ScheduleValidationInput input)
    {
        var issues = new List<ScheduleIssue>();
        var p = input.Policy;
        var active = input.Shifts.Where(s => s.Status != ShiftStatus.Cancelled).ToList();
        var activeIds = active.Select(s => s.Id).ToHashSet();
        var allByEmployee = active
            .Concat(input.ContextShifts.Where(s => s.Status != ShiftStatus.Cancelled && !activeIds.Contains(s.Id)))
            .Where(s => s.EmployeeId is not null)
            .GroupBy(s => s.EmployeeId!.Value)
            .ToDictionary(g => g.Key, g => g.OrderBy(s => s.StartUtc).ToList());

        foreach (var s in active)
        {
            if (s.EndUtc <= s.StartUtc)
            {
                issues.Add(new(IssueSeverity.Error, "shift_invalid_interval", s.Id, s.EmployeeId, s.LocalDate));
                continue;
            }

            if ((decimal)s.DurationHours > p.MaxShiftHours)
                issues.Add(new(IssueSeverity.Warning, "shift_too_long", s.Id, s.EmployeeId, s.LocalDate,
                    Args(("hours", Fmt(s.DurationHours)), ("max", Fmt((double)p.MaxShiftHours)))));

            if (p.CheckBreakRules)
            {
                var work = s.DurationHours - s.BreakMinutes / 60d;
                var required = work > 9 ? 45 : work > 6 ? 30 : 0;
                if (s.BreakMinutes < required)
                    issues.Add(new(IssueSeverity.Warning, "break_too_short", s.Id, s.EmployeeId, s.LocalDate,
                        Args(("required", required.ToString()))));
            }

            CheckOpeningHours(input, s, issues);

            if (s.EmployeeId is null)
            {
                issues.Add(new(p.UnassignedBlocksPublish ? IssueSeverity.Error : IssueSeverity.Warning,
                    "shift_unassigned", s.Id, null, s.LocalDate));
                continue;
            }

            var empId = s.EmployeeId.Value;
            if (!input.Employees.TryGetValue(empId, out var emp))
            {
                issues.Add(new(IssueSeverity.Error, "employee_unknown", s.Id, empId, s.LocalDate));
                continue;
            }

            if (emp.Status is not (EmployeeStatus.Active or EmployeeStatus.Invited))
                issues.Add(new(IssueSeverity.Error, "employee_inactive", s.Id, empId, s.LocalDate, Args(("name", emp.Name))));

            if (!emp.LocationIds.Contains(s.LocationId))
                issues.Add(new(IssueSeverity.Error, "employee_not_at_location", s.Id, empId, s.LocalDate, Args(("name", emp.Name))));

            CheckLeave(input, s, emp, issues);
            CheckAvailability(input, s, emp, issues);

            // Overlaps with any other shift of the same employee (any location).
            foreach (var other in allByEmployee[empId])
            {
                if (other.Id == s.Id) continue;
                if (other.StartUtc < s.EndUtc && s.StartUtc < other.EndUtc)
                {
                    // Report each overlapping pair once when both are in scope.
                    if (activeIds.Contains(other.Id) && other.Id.CompareTo(s.Id) < 0) continue;
                    issues.Add(new(IssueSeverity.Error, "shift_overlap", s.Id, empId, s.LocalDate, Args(("name", emp.Name))));
                }
            }

            // Rest period before this shift.
            var previous = allByEmployee[empId].LastOrDefault(o => o.Id != s.Id && o.EndUtc <= s.StartUtc);
            if (previous is not null)
            {
                var rest = (s.StartUtc - previous.EndUtc).TotalHours;
                if ((decimal)rest < p.MinRestHours)
                    issues.Add(new(IssueSeverity.Warning, "rest_period_short", s.Id, empId, s.LocalDate,
                        Args(("name", emp.Name), ("hours", Fmt(rest)), ("min", Fmt((double)p.MinRestHours)))));
            }
        }

        // Daily totals per employee and local date.
        foreach (var (empId, shifts) in allByEmployee)
        {
            if (!input.Employees.TryGetValue(empId, out var emp)) continue;
            foreach (var day in shifts.GroupBy(s => s.LocalDate))
            {
                if (!day.Any(s => activeIds.Contains(s.Id))) continue;
                var hours = day.Sum(s => s.PaidHours);
                if ((decimal)hours > p.MaxDailyHours)
                    issues.Add(new(IssueSeverity.Warning, "daily_hours_exceeded", null, empId, day.Key,
                        Args(("name", emp.Name), ("hours", Fmt(hours)), ("max", Fmt((double)p.MaxDailyHours)))));
            }
        }

        if (input.WeekStart is { } weekStart)
        {
            var weekEnd = weekStart.AddDays(6);
            foreach (var (empId, shifts) in allByEmployee)
            {
                if (!input.Employees.TryGetValue(empId, out var emp)) continue;
                var weekShifts = shifts.Where(s => s.LocalDate >= weekStart && s.LocalDate <= weekEnd).ToList();
                if (!weekShifts.Any(s => activeIds.Contains(s.Id))) continue;
                var hours = weekShifts.Sum(s => s.PaidHours);
                if ((decimal)hours > p.MaxWeeklyHours)
                    issues.Add(new(IssueSeverity.Warning, "weekly_hours_limit", null, empId, null,
                        Args(("name", emp.Name), ("hours", Fmt(hours)), ("max", Fmt((double)p.MaxWeeklyHours)))));
                else if (emp.ContractHoursPerWeek is { } target && (decimal)hours > target)
                    issues.Add(new(IssueSeverity.Warning, "weekly_target_exceeded", null, empId, null,
                        Args(("name", emp.Name), ("hours", Fmt(hours)), ("target", Fmt((double)target)))));
                else if (emp.ContractHoursPerWeek is { } t2 && (decimal)hours < t2 * 0.5m)
                    issues.Add(new(IssueSeverity.Info, "weekly_target_low", null, empId, null,
                        Args(("name", emp.Name), ("hours", Fmt(hours)), ("target", Fmt((double)t2)))));
            }

            if (p.MinStaffPerDay > 0)
            {
                for (var d = weekStart; d <= weekEnd; d = d.AddDays(1))
                {
                    var opening = input.OpeningHours.FirstOrDefault(o => o.Day == d.DayOfWeek);
                    if (opening is null || opening.IsClosed) continue;
                    var staffed = active.Where(s => s.LocalDate == d && s.EmployeeId is not null)
                        .Select(s => s.EmployeeId).Distinct().Count();
                    if (staffed < p.MinStaffPerDay)
                        issues.Add(new(IssueSeverity.Warning, "coverage_below_minimum", null, null, d,
                            Args(("count", staffed.ToString()), ("min", p.MinStaffPerDay.ToString()))));
                }
            }
        }

        return issues
            .OrderByDescending(i => i.Severity)
            .ThenBy(i => i.Date)
            .ToList();
    }

    private static void CheckOpeningHours(ScheduleValidationInput input, ShiftSlot s, List<ScheduleIssue> issues)
    {
        if (input.OpeningHours.Count == 0) return;
        var day = input.OpeningHours.FirstOrDefault(o => o.Day == s.StartLocal.DayOfWeek);
        if (day is null) return;
        if (day.IsClosed)
        {
            issues.Add(new(IssueSeverity.Warning, "location_closed", s.Id, s.EmployeeId, s.LocalDate));
            return;
        }

        var date = s.LocalDate.ToDateTime(TimeOnly.MinValue);
        var opens = date + day.Opens.ToTimeSpan();
        var closes = date + day.Closes.ToTimeSpan();
        if (day.Closes <= day.Opens) closes = closes.AddDays(1);
        var buffer = TimeSpan.FromMinutes(input.Policy.PrepBufferMinutes);
        if (s.StartLocal < opens - buffer || s.EndLocal > closes + buffer)
            issues.Add(new(IssueSeverity.Warning, "outside_opening_hours", s.Id, s.EmployeeId, s.LocalDate,
                Args(("opens", day.Opens.ToString("HH:mm")), ("closes", day.Closes.ToString("HH:mm")))));
    }

    private static void CheckLeave(ScheduleValidationInput input, ShiftSlot s, EmployeeSnapshot emp, List<ScheduleIssue> issues)
    {
        var endDate = DateOnly.FromDateTime(s.EndLocal.AddTicks(-1));
        foreach (var l in input.Leave.Where(l => l.EmployeeId == emp.Id && l.Start <= endDate && l.End >= s.LocalDate))
        {
            if (l.Status == LeaveStatus.Approved)
                issues.Add(new(IssueSeverity.Error, "employee_on_leave", s.Id, emp.Id, s.LocalDate, Args(("name", emp.Name))));
            else if (l.Status == LeaveStatus.Pending)
                issues.Add(new(IssueSeverity.Info, "employee_leave_pending", s.Id, emp.Id, s.LocalDate, Args(("name", emp.Name))));
        }
    }

    private static void CheckAvailability(ScheduleValidationInput input, ShiftSlot s, EmployeeSnapshot emp, List<ScheduleIssue> issues)
    {
        var startT = TimeOnly.FromDateTime(s.StartLocal);
        var endT = TimeOnly.FromDateTime(s.EndLocal);

        foreach (var u in input.UnavailableDates.Where(u => u.EmployeeId == emp.Id && u.Date == s.LocalDate))
        {
            var whole = u.Start is null || u.End is null;
            if (whole || Overlaps(startT, endT, u.Start!.Value, u.End!.Value))
            {
                issues.Add(new(IssueSeverity.Warning, "employee_unavailable", s.Id, emp.Id, s.LocalDate, Args(("name", emp.Name))));
                return;
            }
        }

        var windows = input.Availability.Where(a => a.EmployeeId == emp.Id).ToList();
        if (windows.Count == 0) return; // no availability recorded: nothing to compare against

        var day = windows.Where(a => a.Day == s.StartLocal.DayOfWeek).ToList();
        if (day.Any(a => a.Kind == AvailabilityKind.Unavailable && Overlaps(startT, endT, a.Start, a.End)))
        {
            issues.Add(new(IssueSeverity.Warning, "employee_unavailable", s.Id, emp.Id, s.LocalDate, Args(("name", emp.Name))));
            return;
        }

        // Only people who recorded positive availability windows are checked for coverage; someone who only
        // recorded unavailability is considered available at all other times.
        if (windows.All(a => a.Kind == AvailabilityKind.Unavailable)) return;
        var covering = day.Where(a => a.Kind != AvailabilityKind.Unavailable).ToList();
        if (!covering.Any(a => Covers(a.Start, a.End, startT, endT)))
            issues.Add(new(IssueSeverity.Warning, "outside_availability", s.Id, emp.Id, s.LocalDate, Args(("name", emp.Name))));
    }

    /// <summary>Whether window [ws, we) covers [s, e). Windows ending at/before their start run past midnight.</summary>
    internal static bool Covers(TimeOnly ws, TimeOnly we, TimeOnly s, TimeOnly e)
    {
        var wStart = ws.ToTimeSpan();
        var wEnd = we <= ws ? we.ToTimeSpan() + TimeSpan.FromDays(1) : we.ToTimeSpan();
        var sStart = s.ToTimeSpan();
        var sEnd = e <= s ? e.ToTimeSpan() + TimeSpan.FromDays(1) : e.ToTimeSpan();
        return sStart >= wStart && sEnd <= wEnd;
    }

    internal static bool Overlaps(TimeOnly aStart, TimeOnly aEnd, TimeOnly bStart, TimeOnly bEnd)
    {
        var a1 = aStart.ToTimeSpan();
        var a2 = aEnd <= aStart ? aEnd.ToTimeSpan() + TimeSpan.FromDays(1) : aEnd.ToTimeSpan();
        var b1 = bStart.ToTimeSpan();
        var b2 = bEnd <= bStart ? bEnd.ToTimeSpan() + TimeSpan.FromDays(1) : bEnd.ToTimeSpan();
        return a1 < b2 && b1 < a2;
    }

    private static string Fmt(double v) => v.ToString("0.##", System.Globalization.CultureInfo.GetCultureInfo("de-DE"));

    private static IReadOnlyDictionary<string, string> Args(params (string Key, string Value)[] items) =>
        items.ToDictionary(i => i.Key, i => i.Value);
}
