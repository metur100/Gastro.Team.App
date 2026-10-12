using GastroTeam.Application.Common;
using GastroTeam.Domain.Entities;
using GastroTeam.Domain.Scheduling;
using FluentValidation;
using Microsoft.EntityFrameworkCore;

namespace GastroTeam.Application.Features.Locations;

public sealed record OpeningHourDto(DayOfWeek DayOfWeek, bool IsClosed, TimeOnly OpensAt, TimeOnly ClosesAt);

public sealed record LocationDto(
    Guid Id, string Name, string? Street, string? PostalCode, string? City, string Country, string TimeZoneId,
    string? Phone, string? Email, bool IsActive, int MinStaffPerDay, int DefaultBreakMinutes, int PrepBufferMinutes,
    IReadOnlyList<OpeningHourDto> OpeningHours, int EmployeeCount, bool CanManage);

public sealed record SaveLocationRequest(
    string Name, string? Street, string? PostalCode, string? City, string? Country, string TimeZoneId,
    string? Phone, string? Email, bool IsActive, int MinStaffPerDay, int DefaultBreakMinutes, int PrepBufferMinutes);

public sealed record SaveOpeningHoursRequest(IReadOnlyList<OpeningHourDto> Days);

public sealed record JobRoleDto(Guid Id, string Name, string Color, int SortOrder, bool IsActive);
public sealed record SaveJobRoleRequest(string Name, string Color, int SortOrder, bool IsActive);

public sealed class SaveLocationRequestValidator : AbstractValidator<SaveLocationRequest>
{
    public SaveLocationRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().WithMessage("Bitte geben Sie einen Namen an.").MaximumLength(120);
        RuleFor(x => x.Street).MaximumLength(150);
        RuleFor(x => x.PostalCode).MaximumLength(10);
        RuleFor(x => x.City).MaximumLength(100);
        RuleFor(x => x.Country).Length(2).When(x => x.Country is not null);
        RuleFor(x => x.TimeZoneId).Must(ZonedTime.IsValidZone).WithMessage("Die Zeitzone ist ungültig.");
        RuleFor(x => x.Phone).MaximumLength(40);
        RuleFor(x => x.Email).EmailAddress().When(x => !string.IsNullOrWhiteSpace(x.Email)).WithMessage("Ungültige E-Mail-Adresse.");
        RuleFor(x => x.MinStaffPerDay).InclusiveBetween(0, 100);
        RuleFor(x => x.DefaultBreakMinutes).InclusiveBetween(0, 240);
        RuleFor(x => x.PrepBufferMinutes).InclusiveBetween(0, 480);
    }
}

public sealed class SaveOpeningHoursRequestValidator : AbstractValidator<SaveOpeningHoursRequest>
{
    public SaveOpeningHoursRequestValidator()
    {
        RuleFor(x => x.Days).NotNull().Must(d => d.Select(x => x.DayOfWeek).Distinct().Count() == d.Count)
            .WithMessage("Jeder Wochentag darf nur einmal vorkommen.");
        RuleForEach(x => x.Days).Must(d => d.IsClosed || d.OpensAt != d.ClosesAt)
            .WithMessage("Öffnungs- und Schließzeit dürfen nicht identisch sein.");
    }
}

public sealed class SaveJobRoleRequestValidator : AbstractValidator<SaveJobRoleRequest>
{
    public SaveJobRoleRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().WithMessage("Bitte geben Sie einen Namen an.").MaximumLength(60);
        RuleFor(x => x.Color).Matches("^#[0-9A-Fa-f]{6}$").WithMessage("Bitte wählen Sie eine gültige Farbe.");
        RuleFor(x => x.SortOrder).InclusiveBetween(0, 1000);
    }
}

public sealed class LocationService(IAppDbContext db, Access access, AuditLogger audit, IClock clock)
{
    public async Task<IReadOnlyList<LocationDto>> ListAsync(bool includeInactive, CancellationToken ct)
    {
        _ = access.TenantId;
        var visible = access.Context.VisibleLocationIds;
        var query = db.Locations.Include(l => l.OpeningHours).Where(l => visible.Contains(l.Id));
        if (!includeInactive) query = query.Where(l => l.IsActive);
        var list = await query.OrderBy(l => l.Name).ToListAsync(ct);
        var counts = await db.EmployeeLocations
            .Where(a => visible.Contains(a.LocationId))
            .Join(db.Employees.Where(e => e.Status == EmployeeStatus.Active || e.Status == EmployeeStatus.Invited), a => a.EmployeeId, e => e.Id, (a, e) => a.LocationId)
            .GroupBy(id => id).Select(g => new { g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        return list.Select(l => ToDto(l, counts.GetValueOrDefault(l.Id))).ToList();
    }

    public async Task<LocationDto> GetAsync(Guid id, CancellationToken ct)
    {
        _ = access.TenantId;
        if (!access.Context.VisibleLocationIds.Contains(id)) throw new NotFoundException();
        var l = await db.Locations.Include(x => x.OpeningHours).SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        var count = await db.EmployeeLocations.CountAsync(a => a.LocationId == id, ct);
        return ToDto(l, count);
    }

    public async Task<LocationDto> CreateAsync(SaveLocationRequest r, CancellationToken ct)
    {
        access.RequireOwner();
        access.EnsureWritable();
        var current = await db.Locations.CountAsync(l => l.IsActive, ct);
        try { Entitlements.EnsureCanAddLocation(access.Plan, current); }
        catch (Domain.Common.DomainException) { throw new BusinessRuleException("plan_location_limit", "Ihr aktueller Tarif erlaubt keine weiteren Standorte. Bitte wechseln Sie den Tarif."); }

        var now = clock.UtcNow;
        var l = new RestaurantLocation { TenantId = access.TenantId, CreatedAt = now };
        Apply(l, r, now);
        // Sensible defaults: open daily 11:00–23:00, closed Mondays. Editable right away.
        foreach (var day in Enum.GetValues<DayOfWeek>())
            l.OpeningHours.Add(new LocationOpeningHour
            {
                TenantId = l.TenantId, LocationId = l.Id, DayOfWeek = day,
                IsClosed = day == DayOfWeek.Monday, OpensAt = new TimeOnly(11, 0), ClosesAt = new TimeOnly(23, 0)
            });
        db.Locations.Add(l);
        audit.Log("location.created", "Location", l.Id, new { l.Name });
        await db.SaveChangesAsync(ct);
        return ToDto(l, 0);
    }

    public async Task<LocationDto> UpdateAsync(Guid id, SaveLocationRequest r, CancellationToken ct)
    {
        access.RequireOwner();
        access.EnsureWritable();
        var l = await db.Locations.Include(x => x.OpeningHours).SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (!l.IsActive && r.IsActive)
        {
            var current = await db.Locations.CountAsync(x => x.IsActive, ct);
            if (current >= access.Plan.MaxLocations)
                throw new BusinessRuleException("plan_location_limit", "Ihr aktueller Tarif erlaubt keine weiteren aktiven Standorte.");
        }
        Apply(l, r, clock.UtcNow);
        audit.Log("location.updated", "Location", l.Id, new { l.Name, l.IsActive });
        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    public async Task<LocationDto> SaveOpeningHoursAsync(Guid id, SaveOpeningHoursRequest r, CancellationToken ct)
    {
        access.RequireManagedLocation(id);
        access.Require(ManagerPermissions.ManageSchedules);
        access.EnsureWritable();
        var l = await db.Locations.Include(x => x.OpeningHours).SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        db.OpeningHours.RemoveRange(l.OpeningHours);
        l.OpeningHours = r.Days.Select(d => new LocationOpeningHour
        {
            TenantId = l.TenantId, LocationId = l.Id, DayOfWeek = d.DayOfWeek, IsClosed = d.IsClosed, OpensAt = d.OpensAt, ClosesAt = d.ClosesAt
        }).ToList();
        db.OpeningHours.AddRange(l.OpeningHours);
        l.UpdatedAt = clock.UtcNow;
        audit.Log("location.opening_hours_updated", "Location", l.Id);
        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    private static void Apply(RestaurantLocation l, SaveLocationRequest r, DateTime now)
    {
        l.Name = r.Name.Trim();
        l.Street = r.Street.NullIfBlank();
        l.PostalCode = r.PostalCode.NullIfBlank();
        l.City = r.City.NullIfBlank();
        l.Country = r.Country?.ToUpperInvariant() ?? "DE";
        l.TimeZoneId = r.TimeZoneId;
        l.Phone = r.Phone.NullIfBlank();
        l.Email = r.Email.NullIfBlank();
        l.IsActive = r.IsActive;
        l.MinStaffPerDay = r.MinStaffPerDay;
        l.DefaultBreakMinutes = r.DefaultBreakMinutes;
        l.PrepBufferMinutes = r.PrepBufferMinutes;
        l.UpdatedAt = now;
    }

    private LocationDto ToDto(RestaurantLocation l, int employees) => new(
        l.Id, l.Name, l.Street, l.PostalCode, l.City, l.Country, l.TimeZoneId, l.Phone, l.Email, l.IsActive,
        l.MinStaffPerDay, l.DefaultBreakMinutes, l.PrepBufferMinutes,
        l.OpeningHours.OrderBy(o => ((int)o.DayOfWeek + 6) % 7).Select(o => new OpeningHourDto(o.DayOfWeek, o.IsClosed, o.OpensAt, o.ClosesAt)).ToList(),
        employees,
        access.Context.IsOwner || access.Context.ManagedLocationIds.Contains(l.Id));
}

public sealed class JobRoleService(IAppDbContext db, Access access, AuditLogger audit, IClock clock)
{
    public async Task<IReadOnlyList<JobRoleDto>> ListAsync(CancellationToken ct)
    {
        _ = access.TenantId;
        return await db.JobRoles.OrderBy(r => r.SortOrder).ThenBy(r => r.Name)
            .Select(r => new JobRoleDto(r.Id, r.Name, r.Color, r.SortOrder, r.IsActive)).ToListAsync(ct);
    }

    public async Task<JobRoleDto> CreateAsync(SaveJobRoleRequest r, CancellationToken ct)
    {
        access.Require(ManagerPermissions.ManageSchedules);
        access.EnsureWritable();
        if (await db.JobRoles.AnyAsync(x => x.Name == r.Name.Trim(), ct))
            throw new ConflictException("duplicate_name", "Eine Rolle mit diesem Namen existiert bereits.");
        var now = clock.UtcNow;
        var role = new JobRole { TenantId = access.TenantId, Name = r.Name.Trim(), Color = r.Color.ToUpperInvariant(), SortOrder = r.SortOrder, IsActive = r.IsActive, CreatedAt = now, UpdatedAt = now };
        db.JobRoles.Add(role);
        audit.Log("jobrole.created", "JobRole", role.Id, new { role.Name });
        await db.SaveChangesAsync(ct);
        return new JobRoleDto(role.Id, role.Name, role.Color, role.SortOrder, role.IsActive);
    }

    public async Task<JobRoleDto> UpdateAsync(Guid id, SaveJobRoleRequest r, CancellationToken ct)
    {
        access.Require(ManagerPermissions.ManageSchedules);
        access.EnsureWritable();
        var role = await db.JobRoles.SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (await db.JobRoles.AnyAsync(x => x.Id != id && x.Name == r.Name.Trim(), ct))
            throw new ConflictException("duplicate_name", "Eine Rolle mit diesem Namen existiert bereits.");
        role.Name = r.Name.Trim();
        role.Color = r.Color.ToUpperInvariant();
        role.SortOrder = r.SortOrder;
        role.IsActive = r.IsActive;
        role.UpdatedAt = clock.UtcNow;
        audit.Log("jobrole.updated", "JobRole", role.Id, new { role.Name, role.IsActive });
        await db.SaveChangesAsync(ct);
        return new JobRoleDto(role.Id, role.Name, role.Color, role.SortOrder, role.IsActive);
    }
}
