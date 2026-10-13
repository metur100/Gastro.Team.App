using System.Net;
using System.Text.Json;
using GastroTeam.Application.Common;
using GastroTeam.Application.Features.Employees;
using GastroTeam.Application.Features.Leave;
using GastroTeam.Application.Features.Notifications;
using GastroTeam.Application.Features.Scheduling;
using GastroTeam.Application.Features.Swaps;
using GastroTeam.Domain.Entities;
using GastroTeam.Domain.Scheduling;
using GastroTeam.Infrastructure.Seeding;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace GastroTeam.Tests.Integration;

[Trait("Category", "Integration")]
public class WorkflowTests(OpenRegistrationFactory factory) : IClassFixture<OpenRegistrationFactory>
{
    [Fact]
    public async Task Onboarding_creates_default_roles_and_trial_subscription()
    {
        var s = await Scenario.CreateAsync(factory);
        Assert.Equal(["Service", "Küche", "Bar", "Schichtleitung"], s.Roles.Select(r => r.Name));
        var me = await s.Owner.GetAsync<JsonElement>("/auth/me");
        var tenant = me.GetProperty("currentTenant");
        Assert.Equal("Owner", tenant.GetProperty("role").GetString());
        Assert.Equal("Trial", tenant.GetProperty("subscription").GetProperty("status").GetString());
        var state = await s.Owner.GetAsync<JsonElement>("/onboarding");
        Assert.Equal(1, state.GetProperty("locations").GetInt32());
    }

    [Fact]
    public async Task Manager_plans_validates_and_publishes_and_employee_sees_only_published_shifts()
    {
        var s = await Scenario.CreateAsync(factory);
        var (mia, miaClient) = await s.AddEmployeeWithLoginAsync("Mia");
        var day = Scenario.FutureTuesday();
        var weekStart = ZonedTime.WeekStart(day);

        var published = await s.CreateShiftAsync(day, "11:00", "17:00", mia.Id);
        var unassigned = await s.CreateShiftAsync(day.AddDays(1), "11:00", "17:00", null);

        // Employee sees nothing while the week is a draft.
        Assert.Empty(await miaClient.GetAsync<List<ShiftDto>>($"/shifts/mine?from={weekStart:yyyy-MM-dd}&to={weekStart.AddDays(6):yyyy-MM-dd}"));

        var report = await s.Owner.GetAsync<ValidationReportDto>($"/schedules/validation?locationId={s.Location.Id}&date={day:yyyy-MM-dd}");
        Assert.Contains(report.Issues, i => i.Code == "shift_unassigned" && i.Severity == "Warning");

        // Warnings need explicit acknowledgement.
        await s.Owner.ExpectFailureAsync(HttpMethod.Post, "/schedules/publish", HttpStatusCode.UnprocessableEntity, "schedule_requires_confirmation",
            new { locationId = s.Location.Id, weekStart, acknowledgeWarnings = false });
        var result = await s.Owner.PostAsync<PublishResult>("/schedules/publish", new { locationId = s.Location.Id, weekStart, acknowledgeWarnings = true });
        Assert.Equal(2, result.PublishedShifts);
        Assert.Equal(1, result.NotifiedEmployees);

        var mine = await miaClient.GetAsync<List<ShiftDto>>($"/shifts/mine?from={weekStart:yyyy-MM-dd}&to={weekStart.AddDays(6):yyyy-MM-dd}");
        var shift = Assert.Single(mine);
        Assert.Equal(published.Id, shift.Id);
        Assert.Equal(new TimeOnly(11, 0), shift.StartTime);

        var notifications = await miaClient.GetAsync<PagedResult<NotificationDto>>("/notifications");
        Assert.Contains(notifications.Items, n => n.Type == "schedule_published");
        Assert.NotEqual(Guid.Empty, unassigned.Id);
    }

    [Fact]
    public async Task Publishing_is_blocked_by_errors()
    {
        var s = await Scenario.CreateAsync(factory);
        var anna = await s.AddEmployeeAsync("Anna");
        var day = Scenario.FutureTuesday();
        await s.CreateShiftAsync(day, "10:00", "16:00", anna.Id);
        await s.CreateShiftAsync(day, "15:00", "20:00", anna.Id); // overlap
        var ex = await s.Owner.ExpectFailureAsync(HttpMethod.Post, "/schedules/publish", HttpStatusCode.UnprocessableEntity, "schedule_has_errors",
            new { locationId = s.Location.Id, weekStart = ZonedTime.WeekStart(day), acknowledgeWarnings = true });
        Assert.Contains("shift_overlap", ex.Body);
    }

    [Fact]
    public async Task Concurrent_shift_edits_return_conflict()
    {
        var s = await Scenario.CreateAsync(factory);
        var day = Scenario.FutureTuesday();
        var shift = await s.CreateShiftAsync(day, "10:00", "16:00", null);
        object Body(string start) => new { locationId = s.Location.Id, jobRoleId = s.RoleId, employeeId = (Guid?)null, date = day, startTime = start, endTime = "18:00", breakMinutes = 30, notes = (string?)null, version = shift.Version };

        await s.Owner.PutAsync<ShiftSaveResult>($"/shifts/{shift.Id}", Body("11:00"));
        await s.Owner.ExpectFailureAsync(HttpMethod.Put, $"/shifts/{shift.Id}", HttpStatusCode.Conflict, "concurrency_conflict", Body("12:00"));
    }

    [Fact]
    public async Task Invalid_shift_intervals_are_rejected()
    {
        var s = await Scenario.CreateAsync(factory);
        await s.Owner.ExpectFailureAsync(HttpMethod.Post, "/shifts", HttpStatusCode.BadRequest, "validation_failed",
            new { locationId = s.Location.Id, jobRoleId = s.RoleId, employeeId = (Guid?)null, date = Scenario.FutureTuesday(), startTime = "10:00", endTime = "10:00", breakMinutes = 0 });
        await s.Owner.ExpectFailureAsync(HttpMethod.Post, "/shifts", HttpStatusCode.BadRequest, "validation_failed",
            new { locationId = s.Location.Id, jobRoleId = s.RoleId, employeeId = (Guid?)null, date = Scenario.FutureTuesday(), startTime = "10:00", endTime = "11:00", breakMinutes = 90 });
    }

    [Fact]
    public async Task Draft_shift_can_be_deleted_but_published_shift_must_be_cancelled()
    {
        var s = await Scenario.CreateAsync(factory);
        var (lea, leaClient) = await s.AddEmployeeWithLoginAsync("Lea");
        var day = Scenario.FutureTuesday();
        var draft = await s.CreateShiftAsync(day, "10:00", "14:00", null);
        Assert.True((await s.Owner.SendAsync(HttpMethod.Delete, $"/shifts/{draft.Id}?version={Uri.EscapeDataString(draft.Version)}")).IsSuccessStatusCode);

        var shift = await s.CreateShiftAsync(day, "10:00", "14:00", lea.Id);
        await s.PublishWeekAsync(day);
        var current = await s.Owner.GetAsync<ShiftDto>($"/shifts/{shift.Id}");
        await s.Owner.ExpectFailureAsync(HttpMethod.Delete, $"/shifts/{shift.Id}?version={Uri.EscapeDataString(current.Version)}", HttpStatusCode.Conflict, "shift_published");
        var cancelled = await s.Owner.PostAsync<ShiftDto>($"/shifts/{shift.Id}/cancel", new { version = current.Version });
        Assert.Equal(ShiftStatus.Cancelled, cancelled.Status);
        var notes = await leaClient.GetAsync<PagedResult<NotificationDto>>("/notifications");
        Assert.Contains(notes.Items, n => n.Type == "shift_cancelled");
    }

    [Fact]
    public async Task Copy_week_creates_drafts()
    {
        var s = await Scenario.CreateAsync(factory);
        var anna = await s.AddEmployeeAsync("Anna");
        var day = Scenario.FutureTuesday();
        await s.CreateShiftAsync(day, "10:00", "16:00", anna.Id);
        await s.CreateShiftAsync(day.AddDays(2), "10:00", "16:00", null);
        var week = ZonedTime.WeekStart(day);
        var result = await s.Owner.PostAsync<CopyResult>("/schedules/copy-week", new { locationId = s.Location.Id, sourceWeekStart = week, targetWeekStart = week.AddDays(7), includeAssignments = true });
        Assert.Equal(2, result.CreatedShifts);
        var target = await s.Owner.GetAsync<WeekViewDto>($"/schedules/week?locationId={s.Location.Id}&date={week.AddDays(7):yyyy-MM-dd}");
        Assert.Equal(2, target.Shifts.Count);
        Assert.All(target.Shifts, x => Assert.Equal(ShiftStatus.Draft, x.Status));
        Assert.Contains(target.Shifts, x => x.EmployeeId == anna.Id);
    }

    [Fact]
    public async Task Leave_request_workflow_with_overlap_protection()
    {
        var s = await Scenario.CreateAsync(factory);
        var (mia, miaClient) = await s.AddEmployeeWithLoginAsync("Mia");
        var start = Scenario.FutureTuesday(4);
        var request = await miaClient.PostAsync<LeaveRequestDto>("/leave-requests", new { type = "Vacation", startDate = start, endDate = start.AddDays(2), note = "Urlaub" });
        Assert.Equal(LeaveStatus.Pending, request.Status);
        await miaClient.ExpectFailureAsync(HttpMethod.Post, "/leave-requests", HttpStatusCode.Conflict, "leave_overlap",
            new { type = "Vacation", startDate = start.AddDays(1), endDate = start.AddDays(3), note = (string?)null });

        // Managers are notified.
        var ownerNotes = await s.Owner.GetAsync<PagedResult<NotificationDto>>("/notifications");
        Assert.Contains(ownerNotes.Items, n => n.Type == "leave_submitted");

        await s.Owner.ExpectFailureAsync(HttpMethod.Post, $"/leave-requests/{request.Id}/reject", HttpStatusCode.BadRequest, "validation_failed", new { version = request.Version, reason = "" });
        var approved = await s.Owner.PostAsync<LeaveRequestDto>($"/leave-requests/{request.Id}/approve", new { version = request.Version, reason = (string?)null });
        Assert.Equal(LeaveStatus.Approved, approved.Status);
        await s.Owner.ExpectFailureAsync(HttpMethod.Post, $"/leave-requests/{request.Id}/approve", HttpStatusCode.UnprocessableEntity, null, new { version = approved.Version });

        // Scheduling on approved leave is now an error.
        await s.CreateShiftAsync(start, "10:00", "16:00", mia.Id);
        var report = await s.Owner.GetAsync<ValidationReportDto>($"/schedules/validation?locationId={s.Location.Id}&date={start:yyyy-MM-dd}");
        Assert.Contains(report.Issues, i => i.Code == "employee_on_leave" && i.Severity == "Error");

        var miaNotes = await miaClient.GetAsync<PagedResult<NotificationDto>>("/notifications");
        Assert.Contains(miaNotes.Items, n => n.Type == "leave_decided");
    }

    [Fact]
    public async Task Leave_can_be_rejected_with_reason_and_cancelled_by_employee_only_while_pending()
    {
        var s = await Scenario.CreateAsync(factory);
        var (_, miaClient) = await s.AddEmployeeWithLoginAsync("Mia");
        var start = Scenario.FutureTuesday(5);
        var r1 = await miaClient.PostAsync<LeaveRequestDto>("/leave-requests", new { type = "Vacation", startDate = start, endDate = start, note = (string?)null });
        var rejected = await s.Owner.PostAsync<LeaveRequestDto>($"/leave-requests/{r1.Id}/reject", new { version = r1.Version, reason = "Messe-Woche" });
        Assert.Equal("Messe-Woche", rejected.DecisionReason);
        await miaClient.ExpectFailureAsync(HttpMethod.Post, $"/leave-requests/{r1.Id}/cancel", HttpStatusCode.UnprocessableEntity, null, new { version = rejected.Version });

        var r2 = await miaClient.PostAsync<LeaveRequestDto>("/leave-requests", new { type = "Vacation", startDate = start.AddDays(1), endDate = start.AddDays(1), note = (string?)null });
        var cancelled = await miaClient.PostAsync<LeaveRequestDto>($"/leave-requests/{r2.Id}/cancel", new { version = r2.Version });
        Assert.Equal(LeaveStatus.Cancelled, cancelled.Status);
    }

    [Fact]
    public async Task Shift_swap_with_manager_approval_is_applied_exactly_once()
    {
        var s = await Scenario.CreateAsync(factory);
        var (mia, miaClient) = await s.AddEmployeeWithLoginAsync("Mia");
        var (paul, paulClient) = await s.AddEmployeeWithLoginAsync("Paul");
        var day = Scenario.FutureTuesday();
        var shift = await s.CreateShiftAsync(day, "17:00", "23:00", mia.Id);
        await s.PublishWeekAsync(day);

        var eligible = await miaClient.GetAsync<List<EligibleColleagueDto>>($"/shift-swaps/eligible-colleagues?shiftId={shift.Id}");
        Assert.Contains(eligible, c => c.Id == paul.Id && !c.HasConflict);

        var swap = await miaClient.PostAsync<SwapDto>("/shift-swaps", new { shiftId = shift.Id, targetEmployeeId = paul.Id, message = "Arzttermin" });
        Assert.True((await paulClient.GetAsync<List<SwapDto>>("/shift-swaps?scope=mine")).Single(x => x.Id == swap.Id).CanAccept);

        var accepted = await paulClient.PostAsync<SwapDto>($"/shift-swaps/{swap.Id}/accept", new { version = swap.Version });
        Assert.Equal(SwapStatus.AwaitingApproval, accepted.Status);

        var approved = await s.Owner.PostAsync<SwapDto>($"/shift-swaps/{swap.Id}/approve", new { version = accepted.Version });
        Assert.Equal(SwapStatus.Completed, approved.Status);
        Assert.Equal(paul.Id, (await s.Owner.GetAsync<ShiftDto>($"/shifts/{shift.Id}")).EmployeeId);

        // A second approval (stale or current version) must never apply the swap again.
        await s.Owner.ExpectFailureAsync(HttpMethod.Post, $"/shift-swaps/{swap.Id}/approve", HttpStatusCode.Conflict, "concurrency_conflict", new { version = accepted.Version });
        await s.Owner.ExpectFailureAsync(HttpMethod.Post, $"/shift-swaps/{swap.Id}/approve", HttpStatusCode.UnprocessableEntity, "swap_invalid_transition", new { version = approved.Version });

        var paulShifts = await paulClient.GetAsync<List<ShiftDto>>($"/shifts/mine?from={day:yyyy-MM-dd}&to={day:yyyy-MM-dd}");
        Assert.Single(paulShifts);
    }

    [Fact]
    public async Task Swap_becomes_obsolete_when_the_shift_was_reassigned()
    {
        var s = await Scenario.CreateAsync(factory);
        var (mia, miaClient) = await s.AddEmployeeWithLoginAsync("Mia");
        var (paul, paulClient) = await s.AddEmployeeWithLoginAsync("Paul");
        var other = await s.AddEmployeeAsync("Otto");
        var day = Scenario.FutureTuesday();
        var shift = await s.CreateShiftAsync(day, "17:00", "23:00", mia.Id);
        await s.PublishWeekAsync(day);
        var swap = await miaClient.PostAsync<SwapDto>("/shift-swaps", new { shiftId = shift.Id, targetEmployeeId = paul.Id, message = (string?)null });

        var current = await s.Owner.GetAsync<ShiftDto>($"/shifts/{shift.Id}");
        await s.Owner.PostAsync<ShiftSaveResult>($"/shifts/{shift.Id}/assign", new { employeeId = other.Id, version = current.Version });

        var latest = await paulClient.GetAsync<SwapDto>($"/shift-swaps/{swap.Id}");
        Assert.Equal(SwapStatus.Invalidated, latest.Status);
        await paulClient.ExpectFailureAsync(HttpMethod.Post, $"/shift-swaps/{swap.Id}/accept", HttpStatusCode.UnprocessableEntity, "swap_invalid_transition", new { version = latest.Version });
    }

    [Fact]
    public async Task Employee_list_supports_search_filter_and_pagination()
    {
        var s = await Scenario.CreateAsync(factory);
        for (var i = 0; i < 7; i++) await s.AddEmployeeAsync($"Person{i:00}");
        var special = await s.AddEmployeeAsync("Zacharias");
        var page1 = await s.Owner.GetAsync<PagedResult<EmployeeDto>>("/employees?pageSize=5&page=1");
        var page2 = await s.Owner.GetAsync<PagedResult<EmployeeDto>>("/employees?pageSize=5&page=2");
        Assert.Equal(8, page1.TotalCount);
        Assert.Equal(5, page1.Items.Count);
        Assert.Equal(3, page2.Items.Count);
        Assert.Empty(page1.Items.Select(x => x.Id).Intersect(page2.Items.Select(x => x.Id)));

        var search = await s.Owner.GetAsync<PagedResult<EmployeeDto>>("/employees?search=Zachar");
        Assert.Equal(special.Id, Assert.Single(search.Items).Id);

        await s.Owner.PostAsync<JsonElement>($"/employees/{special.Id}/deactivate", new { endDate = (DateOnly?)null, version = special.Version });
        var inactive = await s.Owner.GetAsync<PagedResult<EmployeeDto>>("/employees?status=Inactive");
        Assert.Equal(special.Id, Assert.Single(inactive.Items).Id);
    }

    [Fact]
    public async Task Deactivation_unassigns_future_shifts()
    {
        var s = await Scenario.CreateAsync(factory);
        var anna = await s.AddEmployeeAsync("Anna");
        var shift = await s.CreateShiftAsync(Scenario.FutureTuesday(), "10:00", "16:00", anna.Id);
        var result = await s.Owner.PostAsync<DeactivateResult>($"/employees/{anna.Id}/deactivate", new { endDate = (DateOnly?)null, version = anna.Version });
        Assert.Equal(1, result.UnassignedFutureShifts);
        Assert.Null((await s.Owner.GetAsync<ShiftDto>($"/shifts/{shift.Id}")).EmployeeId);
    }

    [Fact]
    public async Task Plan_limits_are_enforced_on_the_server()
    {
        var s = await Scenario.CreateAsync(factory);
        await s.Owner.PostAsync<JsonElement>("/subscription/change-plan", new { planCode = "starter" });
        for (var i = 0; i < 5; i++) await s.AddEmployeeAsync($"E{i}");
        await s.Owner.ExpectFailureAsync(HttpMethod.Post, "/employees", HttpStatusCode.UnprocessableEntity, "plan_employee_limit", new
        {
            firstName = "Zu", lastName = "Viel", locationIds = new[] { s.Location.Id }, sendInvitation = false
        });
        await s.Owner.ExpectFailureAsync(HttpMethod.Post, "/locations", HttpStatusCode.UnprocessableEntity, "plan_location_limit", new
        {
            name = "Zweiter", timeZoneId = "Europe/Berlin", isActive = true, minStaffPerDay = 0, defaultBreakMinutes = 30, prepBufferMinutes = 120
        });
        await s.Owner.ExpectFailureAsync(HttpMethod.Get, "/shift-swaps", HttpStatusCode.UnprocessableEntity, "plan_feature_missing");
    }

    [Fact]
    public async Task Csv_export_is_scoped_and_escaped()
    {
        var s = await Scenario.CreateAsync(factory);
        var evil = await s.AddEmployeeAsync("=HYPERLINK(1)");
        await s.CreateShiftAsync(Scenario.FutureTuesday(), "10:00", "16:00", evil.Id);
        var from = DateOnly.FromDateTime(DateTime.UtcNow);
        var res = await s.Owner.SendAsync(HttpMethod.Get, $"/reports/scheduled-hours?from={from:yyyy-MM-dd}&to={from.AddDays(60):yyyy-MM-dd}&format=csv");
        Assert.True(res.IsSuccessStatusCode);
        Assert.Equal("text/csv", res.Content.Headers.ContentType?.MediaType);
        var csv = await res.Content.ReadAsStringAsync();
        Assert.Contains("\"'=HYPERLINK(1) Test\"", csv);
    }

    [Fact]
    public async Task Demo_seeder_is_idempotent()
    {
        DemoSeedResult? first = null, second = null;
        await factory.WithDbAsync(async _ => { });
        using (var scope = factory.Services.CreateScope())
            first = await scope.ServiceProvider.GetRequiredService<DemoSeeder>().SeedAsync("Demo-Passwort-2026");
        using (var scope = factory.Services.CreateScope())
            second = await scope.ServiceProvider.GetRequiredService<DemoSeeder>().SeedAsync("Demo-Passwort-2026");
        Assert.True(first.Created);
        Assert.False(second.Created);
        Assert.Equal(first.TenantId, second.TenantId);
        await factory.WithDbAsync(async db =>
        {
            Assert.True(await db.Shifts.IgnoreQueryFilters().CountAsync(x => x.TenantId == first.TenantId) > 20);
        });
    }
}
