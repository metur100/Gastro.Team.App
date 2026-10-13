using System.Text.Json;
using System.Text.RegularExpressions;
using GastroTeam.Application.Features.Account;
using GastroTeam.Application.Features.Employees;
using GastroTeam.Application.Features.Invitations;
using GastroTeam.Application.Features.Locations;
using GastroTeam.Application.Features.Scheduling;
using GastroTeam.Domain.Scheduling;

namespace GastroTeam.Tests.Integration;

/// <summary>Builds realistic tenants through the public API (never by writing to the database directly).</summary>
public sealed class Scenario
{
    public const string Password = "Test-Passwort-2026!";

    public required GastroTeamFactory Factory { get; init; }
    public required ApiClient Owner { get; init; }
    public required Guid TenantId { get; init; }
    public required LocationDto Location { get; init; }
    public required List<JobRoleDto> Roles { get; init; }

    public Guid RoleId => Roles[0].Id;

    public static string UniqueEmail(string prefix) => $"{prefix}-{Guid.NewGuid():N}@test.example";

    /// <summary>Registers an owner (verifying the e-mail via the dev mailbox if required) and creates a business + location.</summary>
    public static async Task<Scenario> CreateAsync(GastroTeamFactory factory, string name = "Testbistro")
    {
        var owner = factory.Client();
        var email = UniqueEmail("owner");
        await RegisterAndVerifyAsync(owner, email, "Olivia", "Owner");
        await owner.LoginAsync(email, Password);

        var created = await owner.PostAsync<JsonElement>("/onboarding/business", new { name, contactEmail = (string?)null, phone = (string?)null, timeZone = "Europe/Berlin" });
        var tenantId = created.GetProperty("tenantId").GetGuid();
        owner.TenantId = tenantId;

        var location = await owner.PostAsync<LocationDto>("/locations", new
        {
            name = "Altstadt", street = "Markt 1", postalCode = "40213", city = "Düsseldorf", country = "DE", timeZoneId = "Europe/Berlin",
            phone = (string?)null, email = (string?)null, isActive = true, minStaffPerDay = 0, defaultBreakMinutes = 30, prepBufferMinutes = 120
        });
        var roles = await owner.GetAsync<List<JobRoleDto>>("/job-roles");
        return new Scenario { Factory = factory, Owner = owner, TenantId = tenantId, Location = location, Roles = roles };
    }

    public static async Task RegisterAndVerifyAsync(ApiClient client, string email, string first, string last)
    {
        var res = await client.PostRawAsync("/auth/register", new { email, password = Password, firstName = first, lastName = last, acceptTerms = true });
        Assert.True(res.IsSuccessStatusCode, await res.Content.ReadAsStringAsync());
        var mail = client.Factory.Mailbox.All(email).FirstOrDefault(m => m.Subject.Contains("bestätigen"));
        if (mail is null) return; // verification not required in this factory
        var link = ExtractLink(mail.Text, "email-bestaetigen");
        var query = System.Web.HttpUtility.ParseQueryString(new Uri(link).Query);
        var verify = await client.PostRawAsync("/auth/verify-email", new { userId = Guid.Parse(query["userId"]!), token = query["token"] });
        Assert.True(verify.IsSuccessStatusCode, await verify.Content.ReadAsStringAsync());
    }

    public static string ExtractLink(string text, string path)
    {
        var match = Regex.Match(text, @"https?://\S*" + Regex.Escape(path) + @"\S*");
        Assert.True(match.Success, $"No link containing '{path}' in: {text}");
        return match.Value.TrimEnd('.', ',');
    }

    public async Task<EmployeeDto> AddEmployeeAsync(string first, string? email = null, decimal? hours = 40, Guid? locationId = null)
    {
        return await Owner.PostAsync<EmployeeDto>("/employees", new
        {
            firstName = first, lastName = "Test", email, phone = (string?)null, jobRoleId = RoleId, contractHoursPerWeek = hours,
            employmentStartDate = (DateOnly?)null, employmentEndDate = (DateOnly?)null, preferredLanguage = "de-DE",
            locationIds = new[] { locationId ?? Location.Id }, notes = (string?)null, sendInvitation = false
        });
    }

    /// <summary>Creates an employee with a login by inviting and accepting through the public flow.</summary>
    public async Task<(EmployeeDto Employee, ApiClient Client)> AddEmployeeWithLoginAsync(string first, Guid? locationId = null)
    {
        var email = UniqueEmail(first.ToLowerInvariant());
        var employee = await AddEmployeeAsync(first, email, 30, locationId);
        var invitation = await Owner.PostAsync<InvitationCreatedDto>($"/employees/{employee.Id}/invite");
        var token = invitation.Link!.Split("/einladung/")[1];
        var anonymous = Factory.Client();
        await anonymous.PostAsync<JsonElement>("/invitations/accept", new { token, firstName = first, lastName = "Test", password = Password, acceptTerms = true });
        var client = Factory.Client();
        await client.LoginAsync(email, Password);
        client.TenantId = TenantId;
        return (await Owner.GetAsync<EmployeeDto>($"/employees/{employee.Id}"), client);
    }

    public async Task<(MeDto Me, ApiClient Client)> AddManagerAsync(Guid[] locationIds, string[]? permissions = null)
    {
        var email = UniqueEmail("manager");
        var invitation = await Owner.PostAsync<InvitationCreatedDto>("/settings/members/invite", new
        {
            email, firstName = "Mara", lastName = "Manager", locationIds, permissions = permissions ?? ["ManageEmployees", "ManageSchedules", "PublishSchedules", "ApproveLeave", "ManageSwaps", "ViewReports"]
        });
        var token = invitation.Link!.Split("/einladung/")[1];
        await Factory.Client().PostAsync<JsonElement>("/invitations/accept", new { token, firstName = "Mara", lastName = "Manager", password = Password, acceptTerms = true });
        var client = Factory.Client();
        await client.LoginAsync(email, Password);
        client.TenantId = TenantId;
        return (await client.GetAsync<MeDto>("/auth/me"), client);
    }

    public async Task<LocationDto> AddLocationAsync(string name) =>
        await Owner.PostAsync<LocationDto>("/locations", new
        {
            name, street = (string?)null, postalCode = (string?)null, city = (string?)null, country = "DE", timeZoneId = "Europe/Berlin",
            phone = (string?)null, email = (string?)null, isActive = true, minStaffPerDay = 0, defaultBreakMinutes = 30, prepBufferMinutes = 120
        });

    /// <summary>A Tuesday at least two weeks in the future (location is open Tue–Sun by default).</summary>
    public static DateOnly FutureTuesday(int weeksAhead = 2)
    {
        var monday = ZonedTime.WeekStart(DateOnly.FromDateTime(DateTime.UtcNow)).AddDays(7 * weeksAhead);
        return monday.AddDays(1);
    }

    public async Task<ShiftDto> CreateShiftAsync(DateOnly date, string start, string end, Guid? employeeId, Guid? locationId = null, ApiClient? as_ = null)
    {
        var result = await (as_ ?? Owner).PostAsync<ShiftSaveResult>("/shifts", new
        {
            locationId = locationId ?? Location.Id, jobRoleId = RoleId, employeeId, date, startTime = start, endTime = end, breakMinutes = 30, notes = (string?)null
        });
        return result.Shift;
    }

    public async Task PublishWeekAsync(DateOnly date, Guid? locationId = null) =>
        await Owner.PostAsync<PublishResult>("/schedules/publish", new { locationId = locationId ?? Location.Id, weekStart = ZonedTime.WeekStart(date), acknowledgeWarnings = true });
}
