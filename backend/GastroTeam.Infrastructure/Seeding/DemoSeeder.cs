using GastroTeam.Domain.Entities;
using GastroTeam.Domain.Scheduling;
using GastroTeam.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GastroTeam.Infrastructure.Seeding;

public sealed record DemoSeedResult(bool Created, Guid TenantId, IReadOnlyList<string> Logins);

/// <summary>
/// Deterministic fictional demo data ("Rheinblick Bistro"). Only invoked explicitly (CLI "seed-demo" or the
/// development endpoint). Uses reserved example domains; never sends e-mails.
/// </summary>
public sealed class DemoSeeder(AppDbContext db, UserManager<ApplicationUser> users, ILogger<DemoSeeder> logger)
{
    public const string OwnerEmail = "inhaber@rheinblick.example";
    public const string ManagerEmail = "leitung@rheinblick.example";
    public const string EmployeeEmail = "mia.schmidt@rheinblick.example";

    private static readonly (string First, string Last, string Role, decimal Hours, int Loc, bool Login)[] Team =
    [
        ("Mia", "Schmidt", "Service", 30, 0, true),
        ("Lukas", "Wagner", "Küche", 40, 0, true),
        ("Sofia", "Hoffmann", "Bar", 20, 0, false),
        ("Paul", "Schäfer", "Service", 12, 0, false),
        ("Lea", "Koch", "Küche", 38, 0, false),
        ("Noah", "Richter", "Schichtleitung", 40, 0, false),
        ("Emma", "Klein", "Service", 25, 1, false),
        ("Ben", "Wolf", "Küche", 40, 1, false),
        ("Hannah", "Neumann", "Bar", 15, 1, false),
        ("Elias", "Schwarz", "Service", 20, 1, false),
    ];

    public async Task<DemoSeedResult> SeedAsync(string password, DateOnly? referenceDate = null, CancellationToken ct = default)
    {
        var existingOwner = await users.FindByEmailAsync(OwnerEmail);
        if (existingOwner is not null)
        {
            var tenantId = await db.Memberships.IgnoreQueryFilters().Where(m => m.UserId == existingOwner.Id).Select(m => m.TenantId).FirstAsync(ct);
            return new DemoSeedResult(false, tenantId, [OwnerEmail, ManagerEmail, EmployeeEmail]);
        }

        var now = DateTime.UtcNow;
        var zone = ZonedTime.Find("Europe/Berlin");
        var today = referenceDate ?? ZonedTime.Today(zone, now);
        var week = ZonedTime.WeekStart(today);

        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var tenant = new Tenant
        {
            Name = "Rheinblick Bistro", ContactEmail = "kontakt@rheinblick.example", Phone = "+49 211 000000",
            DefaultTimeZone = "Europe/Berlin", OnboardingStep = 6, OnboardingCompletedAt = now, CreatedAt = now, UpdatedAt = now
        };
        db.Tenants.Add(tenant);
        db.TenantSettings.Add(new TenantSettings { TenantId = tenant.Id, UpdatedAt = now });
        db.Subscriptions.Add(new Subscription
        {
            TenantId = tenant.Id, PlanCode = "business", Status = SubscriptionStatus.Trial, TrialEndsAt = now.AddDays(30),
            IsTestMode = true, CreatedAt = now, UpdatedAt = now
        });

        var altstadt = Location(tenant.Id, "Düsseldorf Altstadt", "Bolkerstraße 1", "40213", now, 2);
        var hafen = Location(tenant.Id, "Düsseldorf Hafen", "Speditionstraße 5", "40221", now, 2);
        db.Locations.AddRange(altstadt, hafen);
        var locations = new[] { altstadt, hafen };

        var roles = new Dictionary<string, JobRole>();
        var order = 0;
        foreach (var (name, color) in new[] { ("Service", "#0F766E"), ("Küche", "#B45309"), ("Bar", "#7C3AED"), ("Schichtleitung", "#1D4ED8") })
        {
            var r = new JobRole { TenantId = tenant.Id, Name = name, Color = color, SortOrder = order++, CreatedAt = now, UpdatedAt = now };
            roles[name] = r;
            db.JobRoles.Add(r);
        }
        await db.SaveChangesAsync(ct);

        var owner = await CreateUserAsync(OwnerEmail, "Clara", "Becker", password, now);
        var manager = await CreateUserAsync(ManagerEmail, "Jonas", "Weber", password, now);
        db.Memberships.Add(new TenantMembership { TenantId = tenant.Id, UserId = owner.Id, Role = MembershipRole.Owner, Permissions = ManagerPermissions.All, CreatedAt = now, UpdatedAt = now });
        var managerMembership = new TenantMembership { TenantId = tenant.Id, UserId = manager.Id, Role = MembershipRole.Manager, Permissions = ManagerPermissions.All, CreatedAt = now, UpdatedAt = now };
        managerMembership.Locations.Add(new MembershipLocation { TenantId = tenant.Id, MembershipId = managerMembership.Id, LocationId = altstadt.Id });
        db.Memberships.Add(managerMembership);

        var employees = new List<Employee>();
        foreach (var t in Team)
        {
            var email = $"{Slug(t.First)}.{Slug(t.Last)}@rheinblick.example";
            var e = new Employee
            {
                TenantId = tenant.Id, FirstName = t.First, LastName = t.Last, Email = email, NormalizedEmail = email.ToUpperInvariant(),
                JobRoleId = roles[t.Role].Id, ContractHoursPerWeek = t.Hours, EmploymentStartDate = new DateOnly(2024, 3, 1).AddDays(employees.Count * 17),
                Status = EmployeeStatus.Active, CreatedAt = now, UpdatedAt = now
            };
            e.Locations.Add(new EmployeeLocationAssignment { TenantId = tenant.Id, EmployeeId = e.Id, LocationId = locations[t.Loc].Id });
            if (t.Login)
            {
                var u = await CreateUserAsync(email, t.First, t.Last, password, now);
                e.UserId = u.Id;
                db.Memberships.Add(new TenantMembership { TenantId = tenant.Id, UserId = u.Id, Role = MembershipRole.Employee, CreatedAt = now, UpdatedAt = now });
            }
            employees.Add(e);
            db.Employees.Add(e);
        }
        // Sofia also helps out at the harbour location.
        employees[2].Locations.Add(new EmployeeLocationAssignment { TenantId = tenant.Id, EmployeeId = employees[2].Id, LocationId = hafen.Id });
        // One invited person without a login yet.
        var invited = new Employee
        {
            TenantId = tenant.Id, FirstName = "Jana", LastName = "Krüger", Email = "jana.krueger@rheinblick.example",
            NormalizedEmail = "JANA.KRUEGER@RHEINBLICK.EXAMPLE", JobRoleId = roles["Service"].Id, ContractHoursPerWeek = 10,
            Status = EmployeeStatus.Invited, CreatedAt = now, UpdatedAt = now
        };
        invited.Locations.Add(new EmployeeLocationAssignment { TenantId = tenant.Id, EmployeeId = invited.Id, LocationId = altstadt.Id });
        db.Employees.Add(invited);
        await db.SaveChangesAsync(ct);

        // Mia: weekday availability, Sofia unavailable on Mondays.
        foreach (var day in new[] { DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday, DayOfWeek.Saturday })
            db.Availability.Add(new EmployeeAvailability
            {
                TenantId = tenant.Id, EmployeeId = employees[0].Id, DayOfWeek = day, StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(23, 59),
                Kind = day == DayOfWeek.Saturday ? AvailabilityKind.Preferred : AvailabilityKind.Available, ValidFrom = week.AddDays(-28), CreatedAt = now
            });
        db.Availability.Add(new EmployeeAvailability
        {
            TenantId = tenant.Id, EmployeeId = employees[2].Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(0, 0), EndTime = new TimeOnly(23, 59),
            Kind = AvailabilityKind.Unavailable, Note = "Studium", ValidFrom = week.AddDays(-28), CreatedAt = now
        });

        // Shifts: current week published, next week draft.
        var pattern = new (int Emp, int Day, int StartH, int EndH, int Break, string Role)[]
        {
            (0, 1, 11, 17, 30, "Service"), (1, 1, 10, 18, 30, "Küche"), (5, 1, 16, 23, 30, "Schichtleitung"),
            (0, 2, 17, 23, 30, "Service"), (4, 2, 10, 18, 30, "Küche"), (2, 2, 18, 23, 0, "Bar"),
            (3, 3, 11, 16, 0, "Service"), (1, 3, 15, 23, 30, "Küche"), (5, 3, 10, 18, 30, "Schichtleitung"),
            (0, 4, 17, 23, 30, "Service"), (4, 4, 10, 18, 30, "Küche"), (2, 4, 19, 23, 0, "Bar"),
            (0, 5, 11, 18, 30, "Service"), (1, 5, 15, 23, 30, "Küche"), (5, 5, 16, 23, 30, "Schichtleitung"),
            (6, 1, 11, 18, 30, "Service"), (7, 1, 10, 18, 30, "Küche"), (8, 4, 18, 23, 0, "Bar"),
            (9, 5, 11, 18, 30, "Service"), (7, 5, 14, 22, 30, "Küche"), (6, 6, 12, 20, 30, "Service"),
        };
        var shifts = new List<Shift>();
        foreach (var weekOffset in new[] { 0, 7 })
        {
            foreach (var p in pattern)
            {
                var emp = employees[p.Emp];
                var loc = emp.Locations[0].LocationId;
                shifts.Add(NewShift(tenant.Id, loc, emp.Id, roles[p.Role].Id, week.AddDays(weekOffset + p.Day), p.StartH, p.EndH, p.Break, owner.Id, zone, now, weekOffset == 0));
            }
            // Unassigned shifts.
            shifts.Add(NewShift(tenant.Id, altstadt.Id, null, roles["Service"].Id, week.AddDays(weekOffset + 5), 17, 23, 30, owner.Id, zone, now, weekOffset == 0));
            shifts.Add(NewShift(tenant.Id, altstadt.Id, null, roles["Bar"].Id, week.AddDays(weekOffset + 5), 19, 1, 0, owner.Id, zone, now, false));
            shifts.Add(NewShift(tenant.Id, hafen.Id, null, roles["Küche"].Id, week.AddDays(weekOffset + 6), 11, 19, 30, owner.Id, zone, now, weekOffset == 0));
        }
        db.Shifts.AddRange(shifts);
        db.ShiftPublications.Add(new ShiftPublication { TenantId = tenant.Id, LocationId = altstadt.Id, WeekStart = week, Action = PublicationAction.Published, CreatedAt = now, UserId = owner.Id, ShiftCount = 16 });

        // Leave requests: pending (Lea next week), approved (Paul next week).
        db.LeaveRequests.Add(new LeaveRequest { TenantId = tenant.Id, EmployeeId = employees[4].Id, Type = LeaveType.Vacation, StartDate = week.AddDays(14), EndDate = week.AddDays(18), Note = "Familienfeier", CreatedAt = now, UpdatedAt = now });
        db.LeaveRequests.Add(new LeaveRequest { TenantId = tenant.Id, EmployeeId = employees[0].Id, Type = LeaveType.Vacation, StartDate = week.AddDays(21), EndDate = week.AddDays(25), CreatedAt = now, UpdatedAt = now });
        db.LeaveRequests.Add(new LeaveRequest
        {
            TenantId = tenant.Id, EmployeeId = employees[3].Id, Type = LeaveType.Vacation, StartDate = week.AddDays(9), EndDate = week.AddDays(11),
            Status = LeaveStatus.Approved, DecidedByUserId = owner.Id, DecidedAt = now, CreatedAt = now, UpdatedAt = now
        });

        // Pending swap: Mia offers her Friday shift (current week, if still in the future) to Paul.
        var miaShift = shifts.Where(s => s.EmployeeId == employees[0].Id && s.Status == ShiftStatus.Published && s.StartUtc > now).OrderBy(s => s.StartUtc).FirstOrDefault()
                       ?? shifts.First(s => s.EmployeeId == employees[0].Id && s.LocalDate >= week.AddDays(7));
        if (miaShift.Status != ShiftStatus.Published) miaShift.Publish(now);
        db.ShiftSwaps.Add(new ShiftSwapRequest
        {
            TenantId = tenant.Id, ShiftId = miaShift.Id, RequesterEmployeeId = employees[0].Id, TargetEmployeeId = employees[3].Id,
            OriginalEmployeeId = employees[0].Id, Message = "Kannst du für mich einspringen? Ich habe einen Arzttermin.", CreatedAt = now, UpdatedAt = now
        });

        // Notifications.
        foreach (var (userId, title, body, link) in new[]
                 {
                     (owner.Id, "Neuer Antrag", "Lea Koch hat Urlaub beantragt.", "/urlaub"),
                     (owner.Id, "Willkommen bei GastroTeam", "Ihr Demo-Restaurant ist eingerichtet. Schauen Sie sich den Schichtplan an.", "/schichtplan"),
                     (manager.Id, "Neuer Antrag", "Lea Koch hat Urlaub beantragt.", "/urlaub"),
                     (employees[0].UserId!.Value, "Schichtplan veröffentlicht", "Ihr Schichtplan für diese Woche ist veröffentlicht.", "/meine-schichten")
                 })
            db.Notifications.Add(new Notification { TenantId = tenant.Id, UserId = userId, Type = "info", Title = title, Body = body, Link = link, CreatedAt = now });

        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        logger.LogInformation("Demo tenant created");
        return new DemoSeedResult(true, tenant.Id, [OwnerEmail, ManagerEmail, EmployeeEmail]);
    }

    private static RestaurantLocation Location(Guid tenantId, string name, string street, string zip, DateTime now, int minStaff)
    {
        var l = new RestaurantLocation
        {
            TenantId = tenantId, Name = name, Street = street, PostalCode = zip, City = "Düsseldorf", TimeZoneId = "Europe/Berlin",
            MinStaffPerDay = minStaff, CreatedAt = now, UpdatedAt = now
        };
        foreach (var day in Enum.GetValues<DayOfWeek>())
            l.OpeningHours.Add(new LocationOpeningHour
            {
                TenantId = tenantId, LocationId = l.Id, DayOfWeek = day, IsClosed = day == DayOfWeek.Monday,
                OpensAt = new TimeOnly(11, 30), ClosesAt = day is DayOfWeek.Friday or DayOfWeek.Saturday ? new TimeOnly(1, 0) : new TimeOnly(23, 0)
            });
        return l;
    }

    private static Shift NewShift(Guid tenantId, Guid locationId, Guid? employeeId, Guid roleId, DateOnly date, int startH, int endH, int breakMin,
        Guid createdBy, TimeZoneInfo zone, DateTime now, bool published)
    {
        var (s, e) = ZonedTime.Interval(date, new TimeOnly(startH, 0), new TimeOnly(endH, 0), zone);
        return new Shift
        {
            TenantId = tenantId, LocationId = locationId, EmployeeId = employeeId, JobRoleId = roleId, StartUtc = s, EndUtc = e, LocalDate = date,
            BreakMinutes = breakMin, Status = published ? ShiftStatus.Published : ShiftStatus.Draft, PublishedAt = published ? now : null,
            CreatedByUserId = createdBy, CreatedAt = now, UpdatedAt = now
        };
    }

    private async Task<ApplicationUser> CreateUserAsync(string email, string first, string last, string password, DateTime now)
    {
        var user = new ApplicationUser
        {
            Id = Guid.CreateVersion7(), Email = email, UserName = email, FirstName = first, LastName = last, EmailConfirmed = true, CreatedAt = now
        };
        var result = await users.CreateAsync(user, password);
        if (!result.Succeeded) throw new InvalidOperationException("Demo user creation failed: " + string.Join(", ", result.Errors.Select(e => e.Code)));
        return user;
    }

    private static string Slug(string s) => s.ToLowerInvariant().Replace("ä", "ae").Replace("ö", "oe").Replace("ü", "ue").Replace("ß", "ss");
}
