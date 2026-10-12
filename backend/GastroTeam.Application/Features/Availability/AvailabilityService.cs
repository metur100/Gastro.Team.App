using GastroTeam.Application.Common;
using GastroTeam.Domain.Entities;
using GastroTeam.Domain.Scheduling;
using FluentValidation;
using Microsoft.EntityFrameworkCore;

namespace GastroTeam.Application.Features.Availability;

public sealed record AvailabilitySlotDto(DayOfWeek DayOfWeek, TimeOnly StartTime, TimeOnly EndTime, AvailabilityKind Kind, string? Note);
public sealed record AvailabilityExceptionDto(Guid Id, DateOnly Date, TimeOnly? StartTime, TimeOnly? EndTime, string? Note);
public sealed record AvailabilityDto(Guid EmployeeId, string EmployeeName, DateOnly? ValidFrom, IReadOnlyList<AvailabilitySlotDto> Weekly, IReadOnlyList<AvailabilityExceptionDto> Exceptions);
public sealed record SaveWeeklyAvailabilityRequest(Guid? EmployeeId, IReadOnlyList<AvailabilitySlotDto> Slots, DateOnly? ValidFrom);
public sealed record CreateAvailabilityExceptionRequest(Guid? EmployeeId, DateOnly Date, TimeOnly? StartTime, TimeOnly? EndTime, string? Note);
public sealed record AvailabilityOverviewItemDto(Guid EmployeeId, string EmployeeName, int WeeklySlots, int UpcomingExceptions, DateOnly? ValidFrom);

public sealed class SaveWeeklyAvailabilityRequestValidator : AbstractValidator<SaveWeeklyAvailabilityRequest>
{
    public SaveWeeklyAvailabilityRequestValidator()
    {
        RuleFor(x => x.Slots).NotNull().Must(s => s.Count <= 50).WithMessage("Zu viele Zeitfenster.");
        RuleForEach(x => x.Slots).Must(s => s.StartTime != s.EndTime).WithMessage("Beginn und Ende dürfen nicht identisch sein.");
        RuleForEach(x => x.Slots).Must(s => s.Note is null || s.Note.Length <= 200).WithMessage("Die Notiz ist zu lang.");
    }
}

public sealed class CreateAvailabilityExceptionRequestValidator : AbstractValidator<CreateAvailabilityExceptionRequest>
{
    public CreateAvailabilityExceptionRequestValidator()
    {
        RuleFor(x => x).Must(x => (x.StartTime is null) == (x.EndTime is null))
            .WithMessage("Bitte geben Sie Beginn und Ende an oder lassen Sie beides leer (ganzer Tag).");
        RuleFor(x => x.Note).MaximumLength(200);
    }
}

public sealed class AvailabilityService(IAppDbContext db, Access access, AuditLogger audit, IClock clock)
{
    /// <summary>Resolves whose availability is addressed and checks the caller may access it.</summary>
    private async Task<Employee> ResolveAsync(Guid? employeeId, bool write, CancellationToken ct)
    {
        var self = access.Context.EmployeeId;
        var id = employeeId ?? self ?? throw new ForbiddenException("Ihr Konto ist mit keinem Mitarbeiterprofil verknüpft.");
        var e = await db.Employees.Include(x => x.Locations).SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (id != self)
        {
            access.RequireManager();
            if (!access.Context.IsOwner && !access.ManagesAny(e.Locations.Select(l => l.LocationId))) throw new NotFoundException();
            if (write) access.Require(ManagerPermissions.ManageSchedules);
        }
        return e;
    }

    public async Task<AvailabilityDto> GetAsync(Guid? employeeId, CancellationToken ct)
    {
        access.RequireFeature(PlanFeatures.Availability);
        var e = await ResolveAsync(employeeId, false, ct);
        var today = DateOnly.FromDateTime(clock.UtcNow);
        var current = await db.Availability.Where(a => a.EmployeeId == e.Id && (a.ValidTo == null || a.ValidTo >= today)).ToListAsync(ct);
        var newest = current.Count == 0 ? (DateOnly?)null : current.Max(a => a.ValidFrom);
        var exceptions = await db.AvailabilityExceptions.Where(a => a.EmployeeId == e.Id && a.Date >= today.AddDays(-7))
            .OrderBy(a => a.Date).ToListAsync(ct);
        return new AvailabilityDto(e.Id, e.FullName, newest,
            current.Where(a => a.ValidFrom == newest).OrderBy(a => ((int)a.DayOfWeek + 6) % 7).ThenBy(a => a.StartTime)
                .Select(a => new AvailabilitySlotDto(a.DayOfWeek, a.StartTime, a.EndTime, a.Kind, a.Note)).ToList(),
            exceptions.Select(x => new AvailabilityExceptionDto(x.Id, x.Date, x.StartTime, x.EndTime, x.Note)).ToList());
    }

    /// <summary>
    /// Replaces the weekly pattern from <c>ValidFrom</c> (default today). Previous rows are closed, not deleted,
    /// and already published shifts are not changed — conflicts surface in schedule validation.
    /// </summary>
    public async Task<AvailabilityDto> SaveWeeklyAsync(SaveWeeklyAvailabilityRequest r, CancellationToken ct)
    {
        access.RequireFeature(PlanFeatures.Availability);
        access.EnsureWritable();
        var e = await ResolveAsync(r.EmployeeId, true, ct);
        var today = DateOnly.FromDateTime(clock.UtcNow);
        var validFrom = r.ValidFrom is { } vf && vf > today ? vf : today;
        var now = clock.UtcNow;

        var open = await db.Availability.Where(a => a.EmployeeId == e.Id && (a.ValidTo == null || a.ValidTo >= validFrom)).ToListAsync(ct);
        foreach (var a in open)
        {
            if (a.ValidFrom >= validFrom) db.Availability.Remove(a); // never effective: safe to drop
            else a.ValidTo = validFrom.AddDays(-1);
        }
        foreach (var s in r.Slots)
            db.Availability.Add(new EmployeeAvailability
            {
                TenantId = e.TenantId, EmployeeId = e.Id, DayOfWeek = s.DayOfWeek, StartTime = s.StartTime, EndTime = s.EndTime,
                Kind = s.Kind, Note = s.Note.NullIfBlank(), ValidFrom = validFrom, CreatedAt = now
            });
        audit.Log("availability.updated", "Employee", e.Id, new { slots = r.Slots.Count, validFrom });
        await db.SaveChangesAsync(ct);
        return await GetAsync(e.Id, ct);
    }

    public async Task<AvailabilityExceptionDto> AddExceptionAsync(CreateAvailabilityExceptionRequest r, CancellationToken ct)
    {
        access.RequireFeature(PlanFeatures.Availability);
        access.EnsureWritable();
        var e = await ResolveAsync(r.EmployeeId, true, ct);
        if (r.Date < DateOnly.FromDateTime(clock.UtcNow).AddDays(-1))
            throw RequestValidationException.For("date", "Das Datum darf nicht in der Vergangenheit liegen.");
        var x = new AvailabilityException
        {
            TenantId = e.TenantId, EmployeeId = e.Id, Date = r.Date, StartTime = r.StartTime, EndTime = r.EndTime,
            Note = r.Note.NullIfBlank(), CreatedAt = clock.UtcNow
        };
        db.AvailabilityExceptions.Add(x);
        audit.Log("availability.exception_added", "Employee", e.Id, new { r.Date });
        await db.SaveChangesAsync(ct);
        return new AvailabilityExceptionDto(x.Id, x.Date, x.StartTime, x.EndTime, x.Note);
    }

    public async Task DeleteExceptionAsync(Guid id, CancellationToken ct)
    {
        access.EnsureWritable();
        var x = await db.AvailabilityExceptions.SingleOrDefaultAsync(a => a.Id == id, ct) ?? throw new NotFoundException();
        await ResolveAsync(x.EmployeeId, true, ct);
        db.AvailabilityExceptions.Remove(x);
        audit.Log("availability.exception_removed", "Employee", x.EmployeeId, new { x.Date });
        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<AvailabilityOverviewItemDto>> OverviewAsync(Guid locationId, CancellationToken ct)
    {
        access.RequireFeature(PlanFeatures.Availability);
        access.RequireManagedLocation(locationId);
        var today = DateOnly.FromDateTime(clock.UtcNow);
        var employees = await db.Employees
            .Where(e => (e.Status == EmployeeStatus.Active || e.Status == EmployeeStatus.Invited) && e.Locations.Any(l => l.LocationId == locationId))
            .OrderBy(e => e.FirstName).ThenBy(e => e.LastName)
            .Select(e => new { e.Id, Name = e.FirstName + " " + e.LastName }).ToListAsync(ct);
        var ids = employees.Select(e => e.Id).ToList();
        var slots = await db.Availability.Where(a => ids.Contains(a.EmployeeId) && (a.ValidTo == null || a.ValidTo >= today))
            .Select(a => new { a.EmployeeId, a.ValidFrom }).ToListAsync(ct);
        var exceptions = await db.AvailabilityExceptions.Where(a => ids.Contains(a.EmployeeId) && a.Date >= today)
            .GroupBy(a => a.EmployeeId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        return employees.Select(e =>
        {
            var own = slots.Where(s => s.EmployeeId == e.Id).ToList();
            var newest = own.Count == 0 ? (DateOnly?)null : own.Max(s => s.ValidFrom);
            return new AvailabilityOverviewItemDto(e.Id, e.Name, own.Count(s => s.ValidFrom == newest), exceptions.GetValueOrDefault(e.Id), newest);
        }).ToList();
    }
}
