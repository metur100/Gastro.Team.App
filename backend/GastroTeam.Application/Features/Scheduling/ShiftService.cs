using GastroTeam.Application.Common;
using GastroTeam.Application.Localization;
using GastroTeam.Domain.Common;
using GastroTeam.Domain.Entities;
using GastroTeam.Domain.Scheduling;
using Microsoft.EntityFrameworkCore;

namespace GastroTeam.Application.Features.Scheduling;

public sealed class ShiftService(
    IAppDbContext db, Access access, ScheduleValidationBuilder validation, AuditLogger audit, Notifier notifier, IClock clock)
{
    private const int MaxRangeDays = 62;

    public async Task<IReadOnlyList<ShiftDto>> ListAsync(ShiftQuery q, CancellationToken ct)
    {
        access.RequireManager();
        if (q.To < q.From || q.To.DayNumber - q.From.DayNumber > MaxRangeDays)
            throw RequestValidationException.For("to", $"Der Zeitraum darf höchstens {MaxRangeDays} Tage umfassen.");
        var managed = access.Context.ManagedLocationIds;
        var query = db.Shifts.Include(s => s.Employee).Include(s => s.JobRole).Include(s => s.Location)
            .Where(s => managed.Contains(s.LocationId) && s.LocalDate >= q.From && s.LocalDate <= q.To);
        if (q.LocationId is { } loc) query = query.Where(s => s.LocationId == loc);
        if (q.EmployeeId is { } emp) query = query.Where(s => s.EmployeeId == emp);
        if (q.JobRoleId is { } role) query = query.Where(s => s.JobRoleId == role);
        if (q.Status is { } status) query = query.Where(s => s.Status == status);
        else query = query.Where(s => s.Status != ShiftStatus.Cancelled);
        if (q.UnassignedOnly) query = query.Where(s => s.EmployeeId == null);
        var list = await query.OrderBy(s => s.StartUtc).AsSplitQuery().ToListAsync(ct);
        return await MapAsync(list, ct);
    }

    public async Task<ShiftDto> GetAsync(Guid id, CancellationToken ct)
    {
        _ = access.TenantId;
        var s = await Load(id).SingleOrDefaultAsync(ct) ?? throw new NotFoundException();
        var isOwnPublished = s.EmployeeId == access.Context.EmployeeId && s.EmployeeId is not null && s.Status != ShiftStatus.Draft;
        if (!isOwnPublished && !(access.Context.IsManagerOrOwner && access.Context.ManagedLocationIds.Contains(s.LocationId)))
            throw new NotFoundException();
        return await MapAsync(s, ct);
    }

    public async Task<ShiftSaveResult> CreateAsync(SaveShiftRequest r, CancellationToken ct)
    {
        access.Require(ManagerPermissions.ManageSchedules, r.LocationId);
        access.EnsureWritable();
        var location = await db.Locations.SingleOrDefaultAsync(l => l.Id == r.LocationId, ct) ?? throw new NotFoundException();
        var now = clock.UtcNow;
        var shift = new Shift { TenantId = access.TenantId, LocationId = location.Id, CreatedByUserId = access.UserId, CreatedAt = now };
        await ApplyAsync(shift, location, r, ct);
        shift.UpdatedAt = now;
        db.Shifts.Add(shift);
        var issues = await validation.ValidateAsync(location, [shift], ZonedTime.WeekStart(shift.LocalDate), ct);
        audit.Log("shift.created", "Shift", shift.Id, new { shift.LocalDate, shift.EmployeeId });
        await db.SaveChangesAsync(ct);
        return new ShiftSaveResult(await MapAsync(await Load(shift.Id).SingleAsync(ct), ct), Relevant(issues, shift));
    }

    public async Task<ShiftSaveResult> UpdateAsync(Guid id, SaveShiftRequest r, CancellationToken ct)
    {
        access.RequireManager();
        access.EnsureWritable();
        var shift = await db.Shifts.SingleOrDefaultAsync(s => s.Id == id, ct) ?? throw new NotFoundException();
        access.Require(ManagerPermissions.ManageSchedules, shift.LocationId);
        if (r.LocationId != shift.LocationId) access.Require(ManagerPermissions.ManageSchedules, r.LocationId);
        if (shift.Status == ShiftStatus.Cancelled) throw Rule("shift_cancelled");
        db.ApplyClientVersion(shift, r.Version);

        var before = new { shift.EmployeeId, shift.StartUtc, shift.EndUtc, shift.LocationId };
        var location = await db.Locations.SingleOrDefaultAsync(l => l.Id == r.LocationId, ct) ?? throw new NotFoundException();
        await ApplyAsync(shift, location, r, ct);
        shift.UpdatedAt = clock.UtcNow;
        return await SaveChangedAsync(shift, location, before.EmployeeId, before.StartUtc != shift.StartUtc || before.EndUtc != shift.EndUtc || before.LocationId != shift.LocationId, ct);
    }

    public async Task<ShiftSaveResult> AssignAsync(Guid id, AssignShiftRequest r, CancellationToken ct)
    {
        access.RequireManager();
        access.EnsureWritable();
        var shift = await db.Shifts.SingleOrDefaultAsync(s => s.Id == id, ct) ?? throw new NotFoundException();
        access.Require(ManagerPermissions.ManageSchedules, shift.LocationId);
        if (shift.Status == ShiftStatus.Cancelled) throw Rule("shift_cancelled");
        db.ApplyClientVersion(shift, r.Version);
        var previous = shift.EmployeeId;
        if (r.EmployeeId is { } employeeId) await EnsureAssignableAsync(employeeId, shift.LocationId, ct);
        shift.EmployeeId = r.EmployeeId;
        shift.UpdatedAt = clock.UtcNow;
        var location = await db.Locations.SingleAsync(l => l.Id == shift.LocationId, ct);
        return await SaveChangedAsync(shift, location, previous, false, ct);
    }

    private async Task<ShiftSaveResult> SaveChangedAsync(Shift shift, RestaurantLocation location, Guid? previousEmployee, bool timeChanged, CancellationToken ct)
    {
        var issues = await validation.ValidateAsync(location, [shift], ZonedTime.WeekStart(shift.LocalDate), ct);
        var relevant = Relevant(issues, shift);
        if (shift.Status == ShiftStatus.Published && relevant.Any(i => i.Severity == nameof(IssueSeverity.Error)))
            throw new BusinessRuleException("published_shift_invalid",
                "Die Änderung würde einen veröffentlichten Schichtplan ungültig machen: " + relevant.First(i => i.Severity == nameof(IssueSeverity.Error)).Message)
            { Extensions = new { issues = relevant } };

        var employeeChanged = previousEmployee != shift.EmployeeId;
        if (employeeChanged || timeChanged)
            foreach (var swap in await db.ShiftSwaps.Where(s => s.ShiftId == shift.Id && (s.Status == SwapStatus.Pending || s.Status == SwapStatus.AwaitingApproval)).ToListAsync(ct))
                swap.Invalidate();

        if (shift.Status == ShiftStatus.Published) await NotifyChangeAsync(shift, previousEmployee, timeChanged, ct);
        audit.Log("shift.updated", "Shift", shift.Id, new { shift.LocalDate, shift.EmployeeId, previousEmployee, timeChanged });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { throw ConcurrencyErrors.Stale("Die Schicht"); }
        return new ShiftSaveResult(await MapAsync(await Load(shift.Id).SingleAsync(ct), ct), relevant);
    }

    public async Task DeleteAsync(Guid id, string version, CancellationToken ct)
    {
        access.RequireManager();
        access.EnsureWritable();
        var shift = await db.Shifts.SingleOrDefaultAsync(s => s.Id == id, ct) ?? throw new NotFoundException();
        access.Require(ManagerPermissions.ManageSchedules, shift.LocationId);
        if (shift.Status != ShiftStatus.Draft)
            throw new ConflictException("shift_published", "Veröffentlichte Schichten können nicht gelöscht, sondern nur abgesagt werden.");
        db.ApplyClientVersion(shift, version);
        db.Shifts.Remove(shift);
        audit.Log("shift.deleted", "Shift", shift.Id, new { shift.LocalDate });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { throw ConcurrencyErrors.Stale("Die Schicht"); }
    }

    public async Task<ShiftDto> CancelAsync(Guid id, string version, CancellationToken ct)
    {
        access.RequireManager();
        access.EnsureWritable();
        var shift = await db.Shifts.SingleOrDefaultAsync(s => s.Id == id, ct) ?? throw new NotFoundException();
        access.Require(ManagerPermissions.ManageSchedules, shift.LocationId);
        db.ApplyClientVersion(shift, version);
        try { shift.Cancel(clock.UtcNow); }
        catch (DomainException ex) { throw Rule(ex.Code); }
        shift.UpdatedAt = clock.UtcNow;
        foreach (var swap in await db.ShiftSwaps.Where(s => s.ShiftId == shift.Id && (s.Status == SwapStatus.Pending || s.Status == SwapStatus.AwaitingApproval)).ToListAsync(ct))
            swap.Invalidate();
        if (shift.EmployeeId is { } empId && shift.PublishedAt is not null)
        {
            var userId = await db.Employees.Where(e => e.Id == empId).Select(e => e.UserId).SingleAsync(ct);
            var zone = await validation.ZoneForAsync(shift.LocationId, ct);
            if (userId is { } u)
                notifier.Notify(shift.TenantId, [u], NotificationTypes.ShiftCancelled, "Schicht abgesagt",
                    $"Ihre Schicht am {Describe(shift, zone)} wurde abgesagt.", "/meine-schichten");
        }
        audit.Log("shift.cancelled", "Shift", shift.Id, new { shift.LocalDate, shift.EmployeeId });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { throw ConcurrencyErrors.Stale("Die Schicht"); }
        return await MapAsync(await Load(id).SingleAsync(ct), ct);
    }

    public async Task<ShiftSaveResult> DuplicateAsync(Guid id, DuplicateShiftRequest r, CancellationToken ct)
    {
        access.RequireManager();
        var source = await db.Shifts.SingleOrDefaultAsync(s => s.Id == id, ct) ?? throw new NotFoundException();
        var zone = await validation.ZoneForAsync(source.LocationId, ct);
        var start = ZonedTime.ToLocal(source.StartUtc, zone);
        var end = ZonedTime.ToLocal(source.EndUtc, zone);
        return await CreateAsync(new SaveShiftRequest(source.LocationId, source.JobRoleId, r.KeepEmployee ? source.EmployeeId : null,
            r.Date ?? source.LocalDate, TimeOnly.FromDateTime(start), TimeOnly.FromDateTime(end), source.BreakMinutes, source.Notes), ct);
    }

    public async Task<ShiftSaveResult> PublishOneAsync(Guid id, CancellationToken ct)
    {
        access.RequireManager();
        access.EnsureWritable();
        var shift = await db.Shifts.SingleOrDefaultAsync(s => s.Id == id, ct) ?? throw new NotFoundException();
        access.Require(ManagerPermissions.PublishSchedules, shift.LocationId);
        var location = await db.Locations.SingleAsync(l => l.Id == shift.LocationId, ct);
        var issues = Relevant(await validation.ValidateAsync(location, [shift], ZonedTime.WeekStart(shift.LocalDate), ct), shift);
        var errors = issues.Where(i => i.Severity == nameof(IssueSeverity.Error)).ToList();
        if (errors.Count > 0)
            throw new BusinessRuleException("schedule_has_errors", "Die Schicht kann nicht veröffentlicht werden: " + errors[0].Message) { Extensions = new { issues } };
        try { shift.Publish(clock.UtcNow); }
        catch (DomainException ex) { throw Rule(ex.Code); }
        if (shift.EmployeeId is { } empId)
        {
            var userId = await db.Employees.Where(e => e.Id == empId).Select(e => e.UserId).SingleAsync(ct);
            var zone = await validation.ZoneForAsync(shift.LocationId, ct);
            if (userId is { } u)
                notifier.Notify(shift.TenantId, [u], NotificationTypes.ShiftAssigned, "Neue Schicht",
                    $"Sie sind am {Describe(shift, zone)} eingeplant.", "/meine-schichten");
        }
        audit.Log("shift.published", "Shift", shift.Id);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { throw ConcurrencyErrors.Stale("Die Schicht"); }
        return new ShiftSaveResult(await MapAsync(await Load(id).SingleAsync(ct), ct), issues);
    }

    /// <summary>Published shifts of the current employee (drafts are never visible to employees).</summary>
    public async Task<IReadOnlyList<ShiftDto>> MyShiftsAsync(DateOnly from, DateOnly to, CancellationToken ct)
    {
        var employeeId = access.RequireEmployee();
        if (to < from || to.DayNumber - from.DayNumber > 92) throw RequestValidationException.For("to", "Der Zeitraum ist ungültig.");
        var list = await db.Shifts.Include(s => s.Employee).Include(s => s.JobRole).Include(s => s.Location)
            .Where(s => s.EmployeeId == employeeId && s.Status != ShiftStatus.Draft && s.LocalDate >= from && s.LocalDate <= to)
            .OrderBy(s => s.StartUtc).AsSplitQuery().ToListAsync(ct);
        return await MapAsync(list, ct);
    }

    /// <summary>Published team schedule of a location for employees, if the tenant allows it. Notes are omitted.</summary>
    public async Task<IReadOnlyList<ShiftDto>> TeamScheduleAsync(Guid locationId, DateOnly weekStart, CancellationToken ct)
    {
        _ = access.TenantId;
        if (!access.Context.VisibleLocationIds.Contains(locationId)) throw new ForbiddenException();
        if (!access.Context.IsManagerOrOwner)
        {
            var allowed = await db.TenantSettings.Select(s => s.EmployeesSeeColleagueShifts).SingleAsync(ct);
            if (!allowed) throw new ForbiddenException("Der Teamplan ist in Ihrem Betrieb nicht freigegeben.");
        }
        var to = weekStart.AddDays(6);
        var list = await db.Shifts.Include(s => s.Employee).Include(s => s.JobRole).Include(s => s.Location)
            .Where(s => s.LocationId == locationId && s.Status == ShiftStatus.Published && s.LocalDate >= weekStart && s.LocalDate <= to)
            .OrderBy(s => s.StartUtc).AsSplitQuery().ToListAsync(ct);
        return (await MapAsync(list, ct)).Select(s => s with { Notes = null }).ToList();
    }

    private IQueryable<Shift> Load(Guid id) =>
        db.Shifts.Include(s => s.Employee).Include(s => s.JobRole).Include(s => s.Location).Where(s => s.Id == id);

    private async Task ApplyAsync(Shift shift, RestaurantLocation location, SaveShiftRequest r, CancellationToken ct)
    {
        if (!await db.JobRoles.AnyAsync(j => j.Id == r.JobRoleId && j.IsActive, ct))
            throw RequestValidationException.For("jobRoleId", "Die Rolle existiert nicht oder ist deaktiviert.");
        if (r.EmployeeId is { } employeeId && employeeId != shift.EmployeeId) await EnsureAssignableAsync(employeeId, location.Id, ct);
        if (r.EmployeeId is { } same && same == shift.EmployeeId && shift.LocationId != location.Id) await EnsureAssignableAsync(same, location.Id, ct);

        var zone = ZonedTime.Find(location.TimeZoneId);
        DateTime startUtc, endUtc;
        try { (startUtc, endUtc) = ZonedTime.Interval(r.Date, r.StartTime, r.EndTime, zone); }
        catch (DomainException ex) { throw RequestValidationException.For("startTime", Messages.Get(ex.Code)); }
        var minutes = (endUtc - startUtc).TotalMinutes;
        if (minutes <= 0 || minutes > 16 * 60)
            throw RequestValidationException.For("endTime", "Eine Schicht darf höchstens 16 Stunden dauern.");
        if (r.BreakMinutes >= minutes)
            throw RequestValidationException.For("breakMinutes", "Die Pause muss kürzer als die Schicht sein.");

        shift.LocationId = location.Id;
        shift.JobRoleId = r.JobRoleId;
        shift.EmployeeId = r.EmployeeId;
        shift.StartUtc = startUtc;
        shift.EndUtc = endUtc;
        shift.LocalDate = r.Date;
        shift.BreakMinutes = r.BreakMinutes;
        shift.Notes = r.Notes.NullIfBlank();
    }

    private async Task EnsureAssignableAsync(Guid employeeId, Guid locationId, CancellationToken ct)
    {
        var e = await db.Employees.Include(x => x.Locations).SingleOrDefaultAsync(x => x.Id == employeeId, ct)
                ?? throw RequestValidationException.For("employeeId", "Die Person existiert nicht.");
        if (!e.CanBeScheduled) throw RequestValidationException.For("employeeId", $"{e.FullName} ist nicht aktiv und kann nicht eingeplant werden.");
        if (e.Locations.All(l => l.LocationId != locationId))
            throw RequestValidationException.For("employeeId", $"{e.FullName} ist diesem Standort nicht zugeordnet.");
    }

    private async Task NotifyChangeAsync(Shift shift, Guid? previousEmployee, bool timeChanged, CancellationToken ct)
    {
        var zone = await validation.ZoneForAsync(shift.LocationId, ct);
        var ids = new[] { previousEmployee, shift.EmployeeId }.Where(x => x is not null).Select(x => x!.Value).Distinct().ToList();
        var users = await db.Employees.Where(e => ids.Contains(e.Id) && e.UserId != null).ToDictionaryAsync(e => e.Id, e => e.UserId!.Value, ct);
        var when = Describe(shift, zone);
        if (previousEmployee != shift.EmployeeId)
        {
            if (previousEmployee is { } prev && users.TryGetValue(prev, out var prevUser))
                notifier.Notify(shift.TenantId, [prevUser], NotificationTypes.ShiftChanged, "Schicht entfernt",
                    $"Sie sind nicht mehr für die Schicht am {when} eingeplant.", "/meine-schichten");
            if (shift.EmployeeId is { } next && users.TryGetValue(next, out var nextUser))
                notifier.Notify(shift.TenantId, [nextUser], NotificationTypes.ShiftAssigned, "Neue Schicht",
                    $"Sie wurden für die Schicht am {when} eingeplant.", "/meine-schichten");
        }
        else if (timeChanged && shift.EmployeeId is { } same && users.TryGetValue(same, out var u))
        {
            notifier.Notify(shift.TenantId, [u], NotificationTypes.ShiftChanged, "Schicht geändert",
                $"Ihre Schicht wurde geändert: {when}.", "/meine-schichten");
        }
    }

    internal static string Describe(Shift s, TimeZoneInfo zone)
    {
        var start = ZonedTime.ToLocal(s.StartUtc, zone);
        var end = ZonedTime.ToLocal(s.EndUtc, zone);
        return $"{start.ToString("ddd, dd.MM.", Messages.German)} von {start:HH:mm} bis {end:HH:mm} Uhr";
    }

    private static List<IssueDto> Relevant(IReadOnlyList<ScheduleIssue> issues, Shift shift) =>
        issues.Where(i => i.ShiftId == shift.Id || (i.ShiftId is null && i.EmployeeId is not null && i.EmployeeId == shift.EmployeeId))
            .Select(ScheduleValidationBuilder.ToDto).ToList();

    private static BusinessRuleException Rule(string code) => new(code, Messages.Get(code));

    public async Task<ShiftDto> MapAsync(Shift s, CancellationToken ct) => (await MapAsync([s], ct))[0];

    public async Task<IReadOnlyList<ShiftDto>> MapAsync(IReadOnlyList<Shift> shifts, CancellationToken ct)
    {
        var result = new List<ShiftDto>(shifts.Count);
        foreach (var s in shifts)
        {
            var zone = await validation.ZoneForAsync(s.LocationId, ct);
            result.Add(Map(s, zone));
        }
        return result;
    }

    public static ShiftDto Map(Shift s, TimeZoneInfo zone)
    {
        var start = ZonedTime.ToLocal(s.StartUtc, zone);
        var end = ZonedTime.ToLocal(s.EndUtc, zone);
        return new ShiftDto(s.Id, s.LocationId, s.Location?.Name, s.EmployeeId, s.Employee?.FullName, s.JobRoleId,
            s.JobRole?.Name ?? "", s.JobRole?.Color ?? "#0F766E", s.LocalDate, TimeOnly.FromDateTime(start), TimeOnly.FromDateTime(end),
            DateOnly.FromDateTime(end) > s.LocalDate, DateTime.SpecifyKind(s.StartUtc, DateTimeKind.Utc), DateTime.SpecifyKind(s.EndUtc, DateTimeKind.Utc),
            s.BreakMinutes, Math.Round(s.PaidHours, 2), s.Notes, s.Status, s.PublishedAt, s.RowVersion.ToVersion());
    }
}
