using GastroTeam.Domain.Entities;
using GastroTeam.Domain.Scheduling;

namespace GastroTeam.Tests.Unit;

[Trait("Category", "Unit")]
public class ScheduleValidatorTests
{
    private static readonly TimeZoneInfo Berlin = ZonedTime.Find("Europe/Berlin");
    private static readonly Guid Loc = Guid.NewGuid();
    private static readonly Guid Emp = Guid.NewGuid();
    private static readonly DateOnly Monday = new(2026, 11, 2);

    private static SchedulePolicy Policy(bool unassignedBlocks = false, int minStaff = 0) =>
        new(unassignedBlocks, MaxShiftHours: 10, MaxDailyHours: 10, MaxWeeklyHours: 48, MinRestHours: 11, CheckBreakRules: true, minStaff, PrepBufferMinutes: 120);

    private static ShiftSlot Slot(DateOnly date, string start, string end, Guid? employee = null, int breakMinutes = 30, ShiftStatus status = ShiftStatus.Draft, Guid? id = null)
    {
        var (s, e) = ZonedTime.Interval(date, TimeOnly.Parse(start), TimeOnly.Parse(end), Berlin);
        return new ShiftSlot(id ?? Guid.NewGuid(), Loc, employee, s, e, ZonedTime.ToLocal(s, Berlin), ZonedTime.ToLocal(e, Berlin), breakMinutes, status);
    }

    private static Dictionary<Guid, EmployeeSnapshot> Employees(decimal? contract = 40, EmployeeStatus status = EmployeeStatus.Active, bool atLocation = true) =>
        new() { [Emp] = new EmployeeSnapshot(Emp, "Mia Test", status, contract, atLocation ? new HashSet<Guid> { Loc } : new HashSet<Guid>()) };

    private static IReadOnlyList<ScheduleIssue> Run(IReadOnlyList<ShiftSlot> shifts, Dictionary<Guid, EmployeeSnapshot>? employees = null, SchedulePolicy? policy = null,
        IReadOnlyList<AvailabilityWindow>? availability = null, IReadOnlyList<UnavailableDate>? unavailable = null, IReadOnlyList<LeavePeriod>? leave = null,
        IReadOnlyList<OpeningWindow>? opening = null, IReadOnlyList<ShiftSlot>? context = null, DateOnly? week = null) =>
        ScheduleValidator.Validate(new ScheduleValidationInput
        {
            Shifts = shifts,
            ContextShifts = context ?? [],
            Employees = employees ?? Employees(),
            Availability = availability ?? [],
            UnavailableDates = unavailable ?? [],
            Leave = leave ?? [],
            OpeningHours = opening ?? [],
            Policy = policy ?? Policy(),
            WeekStart = week ?? Monday
        });

    private static bool Has(IEnumerable<ScheduleIssue> issues, string code, IssueSeverity severity) => issues.Any(i => i.Code == code && i.Severity == severity);

    [Fact]
    public void Clean_shift_has_no_issues()
    {
        Assert.Empty(Run([Slot(Monday, "10:00", "16:00", Emp)], employees: Employees(contract: null)));
    }

    [Fact]
    public void Overlapping_shifts_are_an_error_reported_once()
    {
        var issues = Run([Slot(Monday, "10:00", "16:00", Emp), Slot(Monday, "15:00", "20:00", Emp)]);
        Assert.Single(issues, i => i.Code == "shift_overlap" && i.Severity == IssueSeverity.Error);
    }

    [Fact]
    public void Overlap_with_shift_at_other_location_is_detected_via_context()
    {
        var other = Slot(Monday, "12:00", "18:00", Emp) with { LocationId = Guid.NewGuid() };
        Assert.True(Has(Run([Slot(Monday, "10:00", "16:00", Emp)], context: [other]), "shift_overlap", IssueSeverity.Error));
    }

    [Fact]
    public void Short_rest_period_is_a_warning()
    {
        var issues = Run([Slot(Monday, "16:00", "23:30", Emp), Slot(Monday.AddDays(1), "07:00", "12:00", Emp)]);
        Assert.True(Has(issues, "rest_period_short", IssueSeverity.Warning));
    }

    [Theory]
    [InlineData("10:00", "17:00", 0, true)]   // 7h work, no break
    [InlineData("10:00", "17:00", 30, false)]
    [InlineData("08:00", "18:00", 30, true)]  // 9.5h work needs 45 min
    [InlineData("08:00", "18:00", 45, false)]
    [InlineData("10:00", "15:30", 0, false)]  // 5.5h needs none
    public void Break_rules(string start, string end, int breakMinutes, bool expectWarning)
    {
        var issues = Run([Slot(Monday, start, end, Emp, breakMinutes)], policy: Policy() with { MaxShiftHours = 12, MaxDailyHours = 12 });
        Assert.Equal(expectWarning, Has(issues, "break_too_short", IssueSeverity.Warning));
    }

    [Fact]
    public void Shift_longer_than_policy_is_a_warning()
    {
        Assert.True(Has(Run([Slot(Monday, "08:00", "20:00", Emp, 60)]), "shift_too_long", IssueSeverity.Warning));
    }

    [Fact]
    public void Daily_limit_counts_all_shifts_of_the_day()
    {
        var issues = Run([Slot(Monday, "06:00", "12:00", Emp, 0), Slot(Monday, "13:00", "19:30", Emp, 0)], policy: Policy() with { CheckBreakRules = false, MinRestHours = 0 });
        Assert.True(Has(issues, "daily_hours_exceeded", IssueSeverity.Warning));
    }

    [Fact]
    public void Weekly_contract_target_exceeded_is_a_warning()
    {
        var shifts = Enumerable.Range(0, 4).Select(i => Slot(Monday.AddDays(i), "10:00", "18:30", Emp)).ToList(); // 4 x 8h = 32h
        Assert.True(Has(Run(shifts, Employees(contract: 20)), "weekly_target_exceeded", IssueSeverity.Warning));
    }

    [Fact]
    public void Weekly_hard_limit_takes_precedence_over_contract()
    {
        var shifts = Enumerable.Range(0, 6).Select(i => Slot(Monday.AddDays(i), "08:00", "17:30", Emp, 45)).ToList(); // 6 x 8.75 = 52.5h
        var issues = Run(shifts, Employees(contract: 40));
        Assert.True(Has(issues, "weekly_hours_limit", IssueSeverity.Warning));
        Assert.False(Has(issues, "weekly_target_exceeded", IssueSeverity.Warning));
    }

    [Fact]
    public void Shift_outside_recorded_availability_is_a_warning()
    {
        var availability = new[] { new AvailabilityWindow(Emp, DayOfWeek.Monday, new TimeOnly(8, 0), new TimeOnly(14, 0), AvailabilityKind.Available) };
        Assert.True(Has(Run([Slot(Monday, "12:00", "18:00", Emp)], availability: availability), "outside_availability", IssueSeverity.Warning));
        Assert.Empty(Run([Slot(Monday, "08:00", "13:00", Emp, 0)], availability: availability, employees: Employees(contract: null)));
    }

    [Fact]
    public void Unavailability_only_pattern_does_not_flag_other_days()
    {
        var availability = new[] { new AvailabilityWindow(Emp, DayOfWeek.Friday, new TimeOnly(0, 0), new TimeOnly(23, 59), AvailabilityKind.Unavailable) };
        Assert.DoesNotContain(Run([Slot(Monday, "10:00", "16:00", Emp)], availability: availability), i => i.Code is "outside_availability" or "employee_unavailable");
        Assert.True(Has(Run([Slot(Monday.AddDays(4), "10:00", "16:00", Emp)], availability: availability), "employee_unavailable", IssueSeverity.Warning));
    }

    [Fact]
    public void Explicit_unavailable_date_is_a_warning()
    {
        var unavailable = new[] { new UnavailableDate(Emp, Monday, null, null) };
        Assert.True(Has(Run([Slot(Monday, "10:00", "16:00", Emp)], unavailable: unavailable), "employee_unavailable", IssueSeverity.Warning));
    }

    [Fact]
    public void Approved_leave_is_an_error_and_pending_leave_is_info()
    {
        var approved = new[] { new LeavePeriod(Emp, Monday, Monday, LeaveStatus.Approved) };
        var pending = new[] { new LeavePeriod(Emp, Monday, Monday, LeaveStatus.Pending) };
        Assert.True(Has(Run([Slot(Monday, "10:00", "16:00", Emp)], leave: approved), "employee_on_leave", IssueSeverity.Error));
        Assert.True(Has(Run([Slot(Monday, "10:00", "16:00", Emp)], leave: pending), "employee_leave_pending", IssueSeverity.Info));
    }

    [Theory]
    [InlineData(false, IssueSeverity.Warning)]
    [InlineData(true, IssueSeverity.Error)]
    public void Unassigned_shift_severity_follows_policy(bool blocks, IssueSeverity expected)
    {
        Assert.True(Has(Run([Slot(Monday, "10:00", "16:00")], policy: Policy(unassignedBlocks: blocks)), "shift_unassigned", expected));
    }

    [Fact]
    public void Employee_not_assigned_to_location_or_inactive_is_an_error()
    {
        Assert.True(Has(Run([Slot(Monday, "10:00", "16:00", Emp)], Employees(atLocation: false)), "employee_not_at_location", IssueSeverity.Error));
        Assert.True(Has(Run([Slot(Monday, "10:00", "16:00", Emp)], Employees(status: EmployeeStatus.Inactive)), "employee_inactive", IssueSeverity.Error));
    }

    [Fact]
    public void Opening_hours_with_prep_buffer_and_closed_days()
    {
        var opening = new[]
        {
            new OpeningWindow(DayOfWeek.Monday, true, default, default),
            new OpeningWindow(DayOfWeek.Tuesday, false, new TimeOnly(11, 0), new TimeOnly(22, 0)),
        };
        var tuesday = Monday.AddDays(1);
        Assert.True(Has(Run([Slot(Monday, "10:00", "16:00", Emp)], opening: opening), "location_closed", IssueSeverity.Warning));
        Assert.DoesNotContain(Run([Slot(tuesday, "09:00", "15:00", Emp)], opening: opening), i => i.Code == "outside_opening_hours"); // within 2h buffer
        Assert.True(Has(Run([Slot(tuesday, "06:00", "12:00", Emp)], opening: opening), "outside_opening_hours", IssueSeverity.Warning));
    }

    [Fact]
    public void Opening_hours_past_midnight_allow_late_shifts()
    {
        var opening = new[] { new OpeningWindow(DayOfWeek.Friday, false, new TimeOnly(17, 0), new TimeOnly(2, 0)) };
        var friday = Monday.AddDays(4);
        Assert.DoesNotContain(Run([Slot(friday, "18:00", "02:00", Emp)], opening: opening), i => i.Code == "outside_opening_hours");
    }

    [Fact]
    public void Coverage_below_minimum_is_reported_per_open_day()
    {
        var opening = Enum.GetValues<DayOfWeek>().Select(d => new OpeningWindow(d, d == DayOfWeek.Sunday, new TimeOnly(11, 0), new TimeOnly(22, 0))).ToList();
        var issues = Run([Slot(Monday, "10:00", "16:00", Emp)], opening: opening, policy: Policy(minStaff: 2));
        Assert.Equal(6, issues.Count(i => i.Code == "coverage_below_minimum")); // Mon–Sat open, Sunday closed
    }

    [Fact]
    public void Cancelled_shifts_are_ignored()
    {
        Assert.Empty(Run([Slot(Monday, "10:00", "16:00", Emp), Slot(Monday, "11:00", "15:00", Emp, status: ShiftStatus.Cancelled)], Employees(contract: null)));
    }

    [Fact]
    public void Issues_are_sorted_by_severity()
    {
        var issues = Run([Slot(Monday, "10:00", "16:00"), Slot(Monday, "10:00", "16:00", Emp, 0), Slot(Monday, "12:00", "14:00", Emp, 0)]);
        Assert.Equal(issues.OrderByDescending(i => i.Severity).Select(i => i.Severity), issues.Select(i => i.Severity));
    }
}
