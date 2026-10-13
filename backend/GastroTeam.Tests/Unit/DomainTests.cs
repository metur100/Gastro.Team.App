using GastroTeam.Application.Features.Reports;
using GastroTeam.Domain.Common;
using GastroTeam.Domain.Entities;
using GastroTeam.Domain.Scheduling;

namespace GastroTeam.Tests.Unit;

[Trait("Category", "Unit")]
public class ZonedTimeTests
{
    private static readonly TimeZoneInfo Berlin = ZonedTime.Find("Europe/Berlin");

    [Fact]
    public void Converts_summer_and_winter_times()
    {
        Assert.Equal(new DateTime(2026, 7, 1, 8, 0, 0, DateTimeKind.Utc), ZonedTime.ToUtc(new DateOnly(2026, 7, 1), new TimeOnly(10, 0), Berlin));
        Assert.Equal(new DateTime(2026, 1, 15, 9, 0, 0, DateTimeKind.Utc), ZonedTime.ToUtc(new DateOnly(2026, 1, 15), new TimeOnly(10, 0), Berlin));
    }

    [Fact]
    public void End_before_start_means_next_day()
    {
        var (start, end) = ZonedTime.Interval(new DateOnly(2026, 6, 5), new TimeOnly(18, 0), new TimeOnly(2, 0), Berlin);
        Assert.Equal(TimeSpan.FromHours(8), end - start);
    }

    [Fact]
    public void Spring_forward_gap_is_rejected()
    {
        var ex = Assert.Throws<DomainException>(() => ZonedTime.ToUtc(new DateOnly(2026, 3, 29), new TimeOnly(2, 30), Berlin));
        Assert.Equal("time_in_dst_gap", ex.Code);
    }

    [Fact]
    public void Fall_back_ambiguous_time_resolves_to_earlier_instant()
    {
        // 02:30 occurs twice on 2026-10-25; the first occurrence is still CEST (UTC+2).
        Assert.Equal(new DateTime(2026, 10, 25, 0, 30, 0, DateTimeKind.Utc), ZonedTime.ToUtc(new DateOnly(2026, 10, 25), new TimeOnly(2, 30), Berlin));
    }

    [Fact]
    public void Duration_across_dst_change_is_real_elapsed_time()
    {
        var (start, end) = ZonedTime.Interval(new DateOnly(2026, 3, 28), new TimeOnly(22, 0), new TimeOnly(6, 0), Berlin);
        Assert.Equal(TimeSpan.FromHours(7), end - start); // one hour is skipped in spring
        var (s2, e2) = ZonedTime.Interval(new DateOnly(2026, 10, 24), new TimeOnly(22, 0), new TimeOnly(6, 0), Berlin);
        Assert.Equal(TimeSpan.FromHours(9), e2 - s2); // one hour is repeated in autumn
    }

    [Theory]
    [InlineData("2026-10-12", "2026-10-12")]
    [InlineData("2026-10-18", "2026-10-12")]
    [InlineData("2026-10-14", "2026-10-12")]
    public void Week_starts_on_monday(string date, string monday)
    {
        Assert.Equal(DateOnly.Parse(monday), ZonedTime.WeekStart(DateOnly.Parse(date)));
    }

    [Fact]
    public void Unknown_time_zone_is_rejected()
    {
        Assert.False(ZonedTime.IsValidZone("Mars/Olympus"));
        Assert.True(ZonedTime.IsValidZone("Europe/Vienna"));
    }
}

[Trait("Category", "Unit")]
public class StateMachineTests
{
    private static readonly DateTime Now = new(2026, 10, 1, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Leave_can_be_approved_once()
    {
        var l = new LeaveRequest();
        l.Approve(Guid.NewGuid(), Now);
        Assert.Equal(LeaveStatus.Approved, l.Status);
        Assert.Equal("leave_invalid_transition", Assert.Throws<DomainException>(() => l.Approve(Guid.NewGuid(), Now)).Code);
        Assert.Throws<DomainException>(() => l.Reject(Guid.NewGuid(), "x", Now));
    }

    [Fact]
    public void Leave_rejection_requires_reason()
    {
        Assert.Equal("leave_reason_required", Assert.Throws<DomainException>(() => new LeaveRequest().Reject(Guid.NewGuid(), " ", Now)).Code);
    }

    [Fact]
    public void Only_managers_can_cancel_approved_future_leave()
    {
        var today = new DateOnly(2026, 10, 1);
        var approved = new LeaveRequest { StartDate = today.AddDays(5), EndDate = today.AddDays(6) };
        approved.Approve(Guid.NewGuid(), Now);
        Assert.Throws<DomainException>(() => approved.Cancel(Guid.NewGuid(), byManager: false, today, Now));
        approved.Cancel(Guid.NewGuid(), byManager: true, today, Now);
        Assert.Equal(LeaveStatus.Cancelled, approved.Status);

        var past = new LeaveRequest { StartDate = today.AddDays(-5), EndDate = today.AddDays(-4) };
        past.Approve(Guid.NewGuid(), Now);
        Assert.Throws<DomainException>(() => past.Cancel(Guid.NewGuid(), byManager: true, today, Now));
    }

    [Fact]
    public void Swap_with_approval_goes_through_awaiting_approval()
    {
        var requester = Guid.NewGuid();
        var target = Guid.NewGuid();
        var swap = new ShiftSwapRequest { RequesterEmployeeId = requester, TargetEmployeeId = target, OriginalEmployeeId = requester };
        swap.Accept(target, requiresApproval: true, Now);
        Assert.Equal(SwapStatus.AwaitingApproval, swap.Status);
        swap.Approve(Guid.NewGuid(), Now);
        Assert.Equal(SwapStatus.Completed, swap.Status);
        Assert.Equal(target, swap.FinalEmployeeId);
        Assert.Throws<DomainException>(() => swap.Approve(Guid.NewGuid(), Now)); // never applied twice
    }

    [Fact]
    public void Swap_without_approval_completes_on_accept()
    {
        var requester = Guid.NewGuid();
        var colleague = Guid.NewGuid();
        var swap = new ShiftSwapRequest { RequesterEmployeeId = requester, OriginalEmployeeId = requester };
        swap.Accept(colleague, requiresApproval: false, Now);
        Assert.Equal(SwapStatus.Completed, swap.Status);
        Assert.Equal(colleague, swap.FinalEmployeeId);
    }

    [Fact]
    public void Swap_rules_for_participants()
    {
        var requester = Guid.NewGuid();
        var target = Guid.NewGuid();
        var swap = new ShiftSwapRequest { RequesterEmployeeId = requester, TargetEmployeeId = target, OriginalEmployeeId = requester };
        Assert.Equal("swap_self", Assert.Throws<DomainException>(() => swap.Accept(requester, true, Now)).Code);
        Assert.Equal("swap_not_target", Assert.Throws<DomainException>(() => swap.Accept(Guid.NewGuid(), true, Now)).Code);
        Assert.Equal("swap_not_requester", Assert.Throws<DomainException>(() => swap.Cancel(target)).Code);
        Assert.Throws<DomainException>(() => swap.Approve(Guid.NewGuid(), Now)); // not yet accepted
        swap.Invalidate();
        Assert.Equal(SwapStatus.Invalidated, swap.Status);
        Assert.Throws<DomainException>(() => swap.Accept(target, true, Now));
    }

    [Fact]
    public void Shift_lifecycle()
    {
        var s = new Shift();
        s.Publish(Now);
        Assert.Equal(ShiftStatus.Published, s.Status);
        s.Unpublish();
        Assert.Equal(ShiftStatus.Draft, s.Status);
        s.Cancel(Now);
        Assert.Throws<DomainException>(() => s.Publish(Now));
        Assert.Throws<DomainException>(() => s.Cancel(Now));
    }

    [Fact]
    public void Employee_anonymization_requires_inactive_and_removes_personal_data()
    {
        var e = new Employee { FirstName = "Mia", LastName = "Muster", Email = "mia@test.example", Phone = "0211", Notes = "x", UserId = Guid.NewGuid() };
        Assert.Throws<DomainException>(() => e.Anonymize(Now));
        e.Deactivate(null);
        e.Anonymize(Now);
        Assert.Equal(EmployeeStatus.Archived, e.Status);
        Assert.Null(e.Email);
        Assert.Null(e.Phone);
        Assert.Null(e.Notes);
        Assert.Null(e.UserId);
        Assert.DoesNotContain("Mia", e.FullName);
        Assert.Throws<DomainException>(() => e.Reactivate());
    }
}

[Trait("Category", "Unit")]
public class EntitlementTests
{
    private static readonly SubscriptionPlan Starter = new() { Code = "starter", MaxLocations = 1, MaxActiveEmployees = 5, Features = PlanFeatures.None };
    private static readonly DateTime Now = new(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Limits_are_enforced()
    {
        Entitlements.EnsureCanAddLocation(Starter, 0);
        Assert.Equal("plan_location_limit", Assert.Throws<DomainException>(() => Entitlements.EnsureCanAddLocation(Starter, 1)).Code);
        Entitlements.EnsureCanActivateEmployee(Starter, 4);
        Assert.Equal("plan_employee_limit", Assert.Throws<DomainException>(() => Entitlements.EnsureCanActivateEmployee(Starter, 5)).Code);
        Assert.Throws<DomainException>(() => Entitlements.EnsureFeature(Starter, PlanFeatures.ShiftSwaps));
    }

    [Theory]
    [InlineData(SubscriptionStatus.Active, 0, true)]
    [InlineData(SubscriptionStatus.PastDue, 0, true)]
    [InlineData(SubscriptionStatus.Trial, 5, true)]
    [InlineData(SubscriptionStatus.Trial, -1, false)]
    [InlineData(SubscriptionStatus.Cancelled, 0, false)]
    [InlineData(SubscriptionStatus.Suspended, 0, false)]
    public void Write_access_by_subscription_status(SubscriptionStatus status, int trialDaysLeft, bool expected)
    {
        Assert.Equal(expected, Entitlements.AllowsWrites(status, Now.AddDays(trialDaysLeft), Now));
    }
}

[Trait("Category", "Unit")]
public class CsvTests
{
    [Theory]
    [InlineData("=SUM(A1:A2)", "\"'=SUM(A1:A2)\"")]
    [InlineData("+49 211", "\"'+49 211\"")]
    [InlineData("-1+1", "\"'-1+1\"")]
    [InlineData("@cmd", "\"'@cmd\"")]
    [InlineData("\tTab", "\"'\tTab\"")]
    [InlineData("Müller; Anna", "\"Müller; Anna\"")]
    [InlineData("Sag \"Hallo\"", "\"Sag \"\"Hallo\"\"\"")]
    [InlineData("Zeile\nzwei", "\"Zeile\nzwei\"")]
    [InlineData("Normal", "Normal")]
    public void Escapes_formula_injection_and_separators(string input, string expected)
    {
        Assert.Equal(expected, ReportService.Escape(input));
    }
}
