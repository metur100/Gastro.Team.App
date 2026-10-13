using System.Net;
using System.Text.Json;
using GastroTeam.Application.Common;
using GastroTeam.Application.Features.Employees;
using GastroTeam.Application.Features.Invitations;
using GastroTeam.Application.Features.Leave;
using GastroTeam.Application.Features.Scheduling;
using GastroTeam.Domain.Entities;
using GastroTeam.Domain.Scheduling;
using Microsoft.EntityFrameworkCore;

namespace GastroTeam.Tests.Integration;

/// <summary>Tenant isolation, role/location scoping and session security (required security test list).</summary>
[Trait("Category", "Integration")]
public class SecurityTests(OpenRegistrationFactory factory) : IClassFixture<OpenRegistrationFactory>
{
    [Fact]
    public async Task S01_tenant_A_cannot_read_tenant_B_employees()
    {
        var a = await Scenario.CreateAsync(factory, "Bistro A");
        var b = await Scenario.CreateAsync(factory, "Bistro B");
        var bEmployee = await b.AddEmployeeAsync("Geheim");

        var list = await a.Owner.GetAsync<PagedResult<EmployeeDto>>("/employees?pageSize=200");
        Assert.DoesNotContain(list.Items, e => e.Id == bEmployee.Id);
        await a.Owner.ExpectFailureAsync(HttpMethod.Get, $"/employees/{bEmployee.Id}", HttpStatusCode.NotFound);
        await a.Owner.ExpectFailureAsync(HttpMethod.Get, $"/employees/{bEmployee.Id}/export", HttpStatusCode.NotFound);
        await a.Owner.ExpectFailureAsync(HttpMethod.Get, $"/availability?employeeId={bEmployee.Id}", HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task S02_tenant_A_cannot_modify_tenant_B_shifts_or_switch_into_tenant_B()
    {
        var a = await Scenario.CreateAsync(factory, "Bistro A");
        var b = await Scenario.CreateAsync(factory, "Bistro B");
        var day = Scenario.FutureTuesday();
        var bShift = await b.CreateShiftAsync(day, "10:00", "16:00", null);

        var update = new { locationId = b.Location.Id, jobRoleId = b.RoleId, employeeId = (Guid?)null, date = day, startTime = "09:00", endTime = "16:00", breakMinutes = 30, version = bShift.Version };
        await a.Owner.ExpectFailureAsync(HttpMethod.Put, $"/shifts/{bShift.Id}", HttpStatusCode.NotFound, body: update);
        await a.Owner.ExpectFailureAsync(HttpMethod.Delete, $"/shifts/{bShift.Id}?version={Uri.EscapeDataString(bShift.Version)}", HttpStatusCode.NotFound);
        await a.Owner.ExpectFailureAsync(HttpMethod.Post, $"/shifts/{bShift.Id}/assign", HttpStatusCode.NotFound, body: new { employeeId = (Guid?)null, version = bShift.Version });
        await a.Owner.ExpectFailureAsync(HttpMethod.Post, "/shifts", HttpStatusCode.Forbidden,
            body: new { locationId = b.Location.Id, jobRoleId = b.RoleId, employeeId = (Guid?)null, date = day, startTime = "10:00", endTime = "12:00", breakMinutes = 0 });

        // Client-supplied tenant ids are only a hint and are validated against memberships.
        a.Owner.TenantId = b.TenantId;
        await a.Owner.ExpectFailureAsync(HttpMethod.Get, "/employees", HttpStatusCode.Forbidden, "tenant_forbidden");
        a.Owner.TenantId = a.TenantId;

        var unchanged = await b.Owner.GetAsync<ShiftDto>($"/shifts/{bShift.Id}");
        Assert.Equal(new TimeOnly(10, 0), unchanged.StartTime);
    }

    [Fact]
    public async Task S03_employee_cannot_access_other_profiles_or_management_endpoints()
    {
        var s = await Scenario.CreateAsync(factory);
        var (_, miaClient) = await s.AddEmployeeWithLoginAsync("Mia");
        var paul = await s.AddEmployeeAsync("Paul");

        await miaClient.ExpectFailureAsync(HttpMethod.Get, $"/employees/{paul.Id}", HttpStatusCode.Forbidden);
        await miaClient.ExpectFailureAsync(HttpMethod.Get, "/employees", HttpStatusCode.Forbidden);
        await miaClient.ExpectFailureAsync(HttpMethod.Get, $"/availability?employeeId={paul.Id}", HttpStatusCode.Forbidden);
        await miaClient.ExpectFailureAsync(HttpMethod.Get, $"/schedules/week?locationId={s.Location.Id}&date={Scenario.FutureTuesday():yyyy-MM-dd}", HttpStatusCode.Forbidden);
        await miaClient.ExpectFailureAsync(HttpMethod.Get, "/reports/scheduled-hours?from=2026-01-01&to=2026-01-31", HttpStatusCode.Forbidden);
        await miaClient.ExpectFailureAsync(HttpMethod.Get, "/settings/members", HttpStatusCode.Forbidden);

        // Colleague list exposes no contact data.
        var colleagues = await miaClient.GetAsync<JsonElement>("/employees/colleagues");
        Assert.DoesNotContain("@", colleagues.GetRawText());
    }

    [Fact]
    public async Task S04_manager_cannot_administer_an_unassigned_location()
    {
        var s = await Scenario.CreateAsync(factory);
        var second = await s.AddLocationAsync("Hafen");
        var (_, manager) = await s.AddManagerAsync([s.Location.Id]);
        var day = Scenario.FutureTuesday();

        await manager.GetAsync<WeekViewDto>($"/schedules/week?locationId={s.Location.Id}&date={day:yyyy-MM-dd}");
        await manager.ExpectFailureAsync(HttpMethod.Get, $"/schedules/week?locationId={second.Id}&date={day:yyyy-MM-dd}", HttpStatusCode.Forbidden);
        await manager.ExpectFailureAsync(HttpMethod.Post, "/shifts", HttpStatusCode.Forbidden,
            body: new { locationId = second.Id, jobRoleId = s.RoleId, employeeId = (Guid?)null, date = day, startTime = "10:00", endTime = "12:00", breakMinutes = 0 });
        await manager.ExpectFailureAsync(HttpMethod.Post, "/schedules/publish", HttpStatusCode.Forbidden, body: new { locationId = second.Id, weekStart = ZonedTime.WeekStart(day), acknowledgeWarnings = true });

        var hafenEmployee = await s.AddEmployeeAsync("Hafenkraft", locationId: second.Id);
        await manager.ExpectFailureAsync(HttpMethod.Get, $"/employees/{hafenEmployee.Id}", HttpStatusCode.NotFound);
        await manager.ExpectFailureAsync(HttpMethod.Post, "/locations", HttpStatusCode.Forbidden, body: new { name = "Neu", timeZoneId = "Europe/Berlin", isActive = true });
        await manager.ExpectFailureAsync(HttpMethod.Get, "/subscription", HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task S05_revoked_session_cannot_continue_refreshing()
    {
        var s = await Scenario.CreateAsync(factory);
        var token = s.Owner.RefreshToken!;
        Assert.True((await s.Owner.PostRawAsync("/auth/logout", new { refreshToken = token })).IsSuccessStatusCode);
        await s.Owner.ExpectFailureAsync(HttpMethod.Post, "/auth/refresh", HttpStatusCode.Unauthorized, "invalid_session", new { refreshToken = token });
    }

    [Fact]
    public async Task S06_expired_or_used_invitations_cannot_be_accepted()
    {
        var s = await Scenario.CreateAsync(factory);
        var e = await s.AddEmployeeAsync("Ina", Scenario.UniqueEmail("ina"));
        var inv = await s.Owner.PostAsync<InvitationCreatedDto>($"/employees/{e.Id}/invite");
        var token = inv.Link!.Split("/einladung/")[1];

        await factory.WithDbAsync(async db =>
        {
            var row = await db.Invitations.IgnoreQueryFilters().SingleAsync(x => x.Id == inv.InvitationId);
            row.ExpiresAt = DateTime.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        });
        var anon = factory.Client();
        await anon.ExpectFailureAsync(HttpMethod.Post, "/invitations/accept", HttpStatusCode.UnprocessableEntity, "invitation_invalid",
            new { token, firstName = "Ina", lastName = "Test", password = Scenario.Password, acceptTerms = true });

        // A fresh invitation works once, then never again.
        var inv2 = await s.Owner.PostAsync<InvitationCreatedDto>($"/employees/{e.Id}/invite");
        var token2 = inv2.Link!.Split("/einladung/")[1];
        await anon.PostAsync<JsonElement>("/invitations/accept", new { token = token2, firstName = "Ina", lastName = "Test", password = Scenario.Password, acceptTerms = true });
        await anon.ExpectFailureAsync(HttpMethod.Post, "/invitations/accept", HttpStatusCode.UnprocessableEntity, "invitation_invalid",
            new { token = token2, firstName = "X", lastName = "Y", password = Scenario.Password, acceptTerms = true });
        var lookup = await anon.PostAsync<PublicInvitationDto>("/invitations/lookup", new { token = token2 });
        Assert.False(lookup.IsValid);
    }

    [Fact]
    public async Task S07_employee_cannot_approve_own_leave_and_manager_needs_another_approver()
    {
        var s = await Scenario.CreateAsync(factory);
        var (_, miaClient) = await s.AddEmployeeWithLoginAsync("Mia");
        var start = Scenario.FutureTuesday(6);
        var request = await miaClient.PostAsync<LeaveRequestDto>("/leave-requests", new { type = "Vacation", startDate = start, endDate = start, note = (string?)null });
        await miaClient.ExpectFailureAsync(HttpMethod.Post, $"/leave-requests/{request.Id}/approve", HttpStatusCode.Forbidden, body: new { version = request.Version });
        await miaClient.ExpectFailureAsync(HttpMethod.Post, $"/leave-requests/{request.Id}/reject", HttpStatusCode.Forbidden, body: new { version = request.Version, reason = "x" });
        var still = await s.Owner.GetAsync<LeaveRequestDto>($"/leave-requests/{request.Id}");
        Assert.Equal(LeaveStatus.Pending, still.Status);
    }

    [Fact]
    public async Task S08_unauthorized_users_cannot_publish_schedules()
    {
        var s = await Scenario.CreateAsync(factory);
        var (_, employee) = await s.AddEmployeeWithLoginAsync("Mia");
        var (_, planner) = await s.AddManagerAsync([s.Location.Id], ["ManageSchedules"]);
        var day = Scenario.FutureTuesday();
        await s.CreateShiftAsync(day, "10:00", "16:00", null);
        var body = new { locationId = s.Location.Id, weekStart = ZonedTime.WeekStart(day), acknowledgeWarnings = true };
        await employee.ExpectFailureAsync(HttpMethod.Post, "/schedules/publish", HttpStatusCode.Forbidden, body: body);
        await planner.ExpectFailureAsync(HttpMethod.Post, "/schedules/publish", HttpStatusCode.Forbidden, body: body);
        // The planner may still edit drafts.
        await s.CreateShiftAsync(day, "12:00", "18:00", null, as_: planner);
    }

    [Fact]
    public async Task S09_swap_cannot_be_applied_twice_by_concurrent_approvals()
    {
        var s = await Scenario.CreateAsync(factory);
        var (mia, miaClient) = await s.AddEmployeeWithLoginAsync("Mia");
        var (paul, paulClient) = await s.AddEmployeeWithLoginAsync("Paul");
        var (_, manager) = await s.AddManagerAsync([s.Location.Id]);
        var day = Scenario.FutureTuesday();
        var shift = await s.CreateShiftAsync(day, "17:00", "23:00", mia.Id);
        await s.PublishWeekAsync(day);
        var swap = await miaClient.PostAsync<GastroTeam.Application.Features.Swaps.SwapDto>("/shift-swaps", new { shiftId = shift.Id, targetEmployeeId = paul.Id, message = (string?)null });
        var accepted = await paulClient.PostAsync<GastroTeam.Application.Features.Swaps.SwapDto>($"/shift-swaps/{swap.Id}/accept", new { version = swap.Version });

        var results = await Task.WhenAll(
            s.Owner.SendAsync(HttpMethod.Post, $"/shift-swaps/{swap.Id}/approve", new { version = accepted.Version }),
            manager.SendAsync(HttpMethod.Post, $"/shift-swaps/{swap.Id}/approve", new { version = accepted.Version }));
        Assert.Equal(1, results.Count(r => r.IsSuccessStatusCode));
        Assert.Contains(results, r => r.StatusCode is HttpStatusCode.Conflict or HttpStatusCode.UnprocessableEntity);
        await factory.WithDbAsync(async db =>
        {
            var audits = await db.AuditLogs.IgnoreQueryFilters().CountAsync(a => a.EntityId == swap.Id && a.Action == "swap.approved");
            Assert.Equal(1, audits);
        });
    }

    [Fact]
    public async Task S10_invalid_cross_tenant_relationships_are_rejected()
    {
        var a = await Scenario.CreateAsync(factory, "Bistro A");
        var b = await Scenario.CreateAsync(factory, "Bistro B");
        var bEmployee = await b.AddEmployeeAsync("Fremd");

        // Through the API: assigning a foreign employee is rejected.
        var day = Scenario.FutureTuesday();
        await a.Owner.ExpectFailureAsync(HttpMethod.Post, "/shifts", HttpStatusCode.BadRequest, "validation_failed",
            new { locationId = a.Location.Id, jobRoleId = a.RoleId, employeeId = bEmployee.Id, date = day, startTime = "10:00", endTime = "12:00", breakMinutes = 0 });
        await a.Owner.ExpectFailureAsync(HttpMethod.Post, "/employees", HttpStatusCode.Forbidden, null,
            new { firstName = "X", lastName = "Y", locationIds = new[] { b.Location.Id }, sendInvitation = false });

        // In the database: composite (TenantId, Id) foreign keys make mixed-tenant rows impossible.
        await factory.WithDbAsync(async db =>
        {
            var (start, end) = ZonedTime.Interval(day, new TimeOnly(10, 0), new TimeOnly(12, 0), ZonedTime.Find("Europe/Berlin"));
            db.Shifts.Add(new Shift
            {
                TenantId = a.TenantId, LocationId = b.Location.Id, JobRoleId = a.RoleId, StartUtc = start, EndUtc = end, LocalDate = day,
                CreatedByUserId = Guid.NewGuid(), CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow
            });
            await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        });
        await factory.WithDbAsync(async db =>
        {
            db.EmployeeLocations.Add(new EmployeeLocationAssignment { TenantId = a.TenantId, EmployeeId = bEmployee.Id, LocationId = a.Location.Id });
            await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        });
    }

    [Fact]
    public async Task Query_filters_fail_closed_without_tenant_context()
    {
        var s = await Scenario.CreateAsync(factory);
        await s.AddEmployeeAsync("Sichtbar");
        await factory.WithDbAsync(async db => Assert.Equal(0, await db.Employees.CountAsync()));
    }

    [Fact]
    public async Task Platform_admin_endpoints_require_platform_admin()
    {
        var s = await Scenario.CreateAsync(factory);
        await s.Owner.ExpectFailureAsync(HttpMethod.Get, "/platform/tenants", HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Sick_leave_notes_are_hidden_from_colleagues_and_visible_to_managers()
    {
        var s = await Scenario.CreateAsync(factory);
        var (_, mia) = await s.AddEmployeeWithLoginAsync("Mia");
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var sick = await mia.PostAsync<LeaveRequestDto>("/leave-requests", new { type = "Sick", startDate = today, endDate = today, note = "Arztbesuch" });
        Assert.Equal("Arztbesuch", (await s.Owner.GetAsync<LeaveRequestDto>($"/leave-requests/{sick.Id}")).Note);
        var (_, paul) = await s.AddEmployeeWithLoginAsync("Paul");
        await paul.ExpectFailureAsync(HttpMethod.Get, $"/leave-requests/{sick.Id}", HttpStatusCode.NotFound);
    }
}

[Trait("Category", "Integration")]
public class ProductionHardeningTests(ProductionLikeFactory factory) : IClassFixture<ProductionLikeFactory>
{
    [Fact]
    public async Task Dev_endpoints_do_not_exist_in_production()
    {
        var res = await factory.Client().SendAsync(HttpMethod.Get, "/dev/emails");
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        var seed = await factory.Client().SendAsync(HttpMethod.Post, "/dev/seed", new { password = "Irgendwas-123" });
        Assert.Equal(HttpStatusCode.NotFound, seed.StatusCode);
    }
}
