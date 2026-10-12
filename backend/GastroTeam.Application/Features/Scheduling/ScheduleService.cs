using GastroTeam.Application.Common;
using GastroTeam.Application.Localization;
using GastroTeam.Domain.Entities;
using GastroTeam.Domain.Scheduling;
using Microsoft.EntityFrameworkCore;

namespace GastroTeam.Application.Features.Scheduling;

public sealed class ScheduleService(
    IAppDbContext db, Access access, ScheduleValidationBuilder validation, AuditLogger audit, Notifier notifier, IClock clock)
{
    private static readonly Dictionary<LeaveType, string> LeaveLabels = new()
    {
        [LeaveType.Vacation] = "Urlaub", [LeaveType.Sick] = "Abwesend", [LeaveType.Unpaid] = "Unbezahlt frei",
        [LeaveType.Training] = "Fortbildung", [LeaveType.Other] = "Abwesend"
    };

    public async Task<WeekViewDto> GetWeekAsync(Guid locationId, DateOnly anyDate, CancellationToken ct)
    {
        access.RequireManagedLocation(locationId);
        var weekStart = ZonedTime.WeekStart(anyDate);
        var weekEnd = weekStart.AddDays(6);
        var location = await db.Locations.Include(l => l.OpeningHours).SingleOrDefaultAsync(l => l.Id == locationId, ct) ?? throw new NotFoundException();
        var zone = ZonedTime.Find(location.TimeZoneId);

        var shifts = await db.Shifts.Include(s => s.Employee).Include(s => s.JobRole)
            .Where(s => s.LocationId == locationId && s.LocalDate >= weekStart && s.LocalDate <= weekEnd && s.Status != ShiftStatus.Cancelled)
            .OrderBy(s => s.StartUtc).AsSplitQuery().ToListAsync(ct);

        var employees = await db.Employees.Include(e => e.JobRole)
            .Where(e => (e.Status == EmployeeStatus.Active || e.Status == EmployeeStatus.Invited) && e.Locations.Any(l => l.LocationId == locationId))
            .OrderBy(e => e.FirstName).ThenBy(e => e.LastName).ToListAsync(ct);
        // Include people who are still assigned to shifts this week even if they changed location/status.
        var missing = shifts.Where(s => s.EmployeeId is not null && employees.All(e => e.Id != s.EmployeeId)).Select(s => s.EmployeeId!.Value).Distinct().ToList();
        if (missing.Count > 0) employees.AddRange(await db.Employees.Include(e => e.JobRole).Where(e => missing.Contains(e.Id)).ToListAsync(ct));
        var empIds = employees.Select(e => e.Id).ToList();

        var fromUtc = weekStart.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc).AddDays(-1);
        var toUtc = weekEnd.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc).AddDays(2);
        var allWeekShifts = await db.Shifts
            .Where(s => s.EmployeeId != null && empIds.Contains(s.EmployeeId.Value) && s.Status != ShiftStatus.Cancelled
                        && s.LocalDate >= weekStart && s.LocalDate <= weekEnd)
            .Select(s => new { s.EmployeeId, s.StartUtc, s.EndUtc, s.BreakMinutes })
            .ToListAsync(ct);
        var planned = allWeekShifts.GroupBy(s => s.EmployeeId!.Value)
            .ToDictionary(g => g.Key, g => g.Sum(s => Math.Max(0, (s.EndUtc - s.StartUtc).TotalMinutes - s.BreakMinutes) / 60d));

        var availability = await db.Availability
            .Where(a => empIds.Contains(a.EmployeeId) && a.ValidFrom <= weekEnd && (a.ValidTo == null || a.ValidTo >= weekStart))
            .ToListAsync(ct);
        var exceptions = await db.AvailabilityExceptions.Where(a => empIds.Contains(a.EmployeeId) && a.Date >= weekStart && a.Date <= weekEnd).ToListAsync(ct);
        var leave = await db.LeaveRequests
            .Where(l => empIds.Contains(l.EmployeeId) && (l.Status == LeaveStatus.Approved || l.Status == LeaveStatus.Pending) && l.StartDate <= weekEnd && l.EndDate >= weekStart)
            .ToListAsync(ct);

        var issues = await validation.ValidateAsync(location, shifts, weekStart, ct);
        var lastPublication = await db.ShiftPublications
            .Where(p => p.LocationId == locationId && p.WeekStart == weekStart && p.Action == PublicationAction.Published)
            .OrderByDescending(p => p.CreatedAt).Select(p => (DateTime?)p.CreatedAt).FirstOrDefaultAsync(ct);

        var days = Enumerable.Range(0, 7).Select(i =>
        {
            var d = weekStart.AddDays(i);
            var o = location.OpeningHours.FirstOrDefault(x => x.DayOfWeek == d.DayOfWeek);
            return new DayInfoDto(d, o?.IsClosed ?? false, o is { IsClosed: false } ? o.OpensAt : null, o is { IsClosed: false } ? o.ClosesAt : null);
        }).ToList();

        var weekEmployees = employees.Select(e =>
        {
            var empAvailability = availability.Where(a => a.EmployeeId == e.Id).ToList();
            var newest = empAvailability.Count == 0 ? (DateOnly?)null : empAvailability.Max(a => a.ValidFrom);
            var absences = new List<AbsenceHintDto>();
            foreach (var l in leave.Where(l => l.EmployeeId == e.Id))
                for (var d = Max(l.StartDate, weekStart); d <= Min(l.EndDate, weekEnd); d = d.AddDays(1))
                    absences.Add(new AbsenceHintDto(d, l.Status == LeaveStatus.Approved ? "leave" : "leave_pending",
                        l.Status == LeaveStatus.Approved ? LeaveLabels[l.Type] : "Antrag offen"));
            foreach (var x in exceptions.Where(x => x.EmployeeId == e.Id))
                absences.Add(new AbsenceHintDto(x.Date, "unavailable",
                    x.StartTime is null ? "Nicht verfügbar" : $"Nicht verfügbar {x.StartTime:HH\\:mm}–{x.EndTime:HH\\:mm}"));
            return new WeekEmployeeDto(e.Id, e.FullName, e.JobRoleId, e.JobRole?.Name, e.ContractHoursPerWeek,
                Math.Round(planned.GetValueOrDefault(e.Id), 2), e.Status,
                empAvailability.Where(a => a.ValidFrom == newest).OrderBy(a => a.DayOfWeek).ThenBy(a => a.StartTime)
                    .Select(a => new AvailabilityHintDto(a.DayOfWeek, a.StartTime, a.EndTime, a.Kind)).ToList(),
                absences);
        }).ToList();

        var draft = shifts.Count(s => s.Status == ShiftStatus.Draft);
        var published = shifts.Count(s => s.Status == ShiftStatus.Published);
        var state = shifts.Count == 0 ? "empty" : draft == 0 ? "published" : published == 0 ? "draft" : "partial";

        return new WeekViewDto(location.Id, location.Name, location.TimeZoneId, weekStart, days,
            shifts.Select(s => ShiftService.Map(s, zone)).ToList(), weekEmployees,
            issues.Select(ScheduleValidationBuilder.ToDto).ToList(),
            new PublicationStateDto(state, draft, published, lastPublication),
            Math.Round(shifts.Sum(s => s.PaidHours), 2), shifts.Count(s => s.EmployeeId is null));
    }

    public async Task<ValidationReportDto> ValidateWeekAsync(Guid locationId, DateOnly anyDate, CancellationToken ct)
    {
        access.RequireManagedLocation(locationId);
        var weekStart = ZonedTime.WeekStart(anyDate);
        var (location, shifts) = await LoadWeekAsync(locationId, weekStart, ct);
        var issues = (await validation.ValidateAsync(location, shifts, weekStart, ct)).Select(ScheduleValidationBuilder.ToDto).ToList();
        return Report(issues);
    }

    public async Task<PublishResult> PublishWeekAsync(PublishWeekRequest r, CancellationToken ct)
    {
        access.Require(ManagerPermissions.PublishSchedules, r.LocationId);
        access.EnsureWritable();
        var weekStart = ZonedTime.WeekStart(r.WeekStart);
        var (location, shifts) = await LoadWeekAsync(r.LocationId, weekStart, ct);
        var drafts = shifts.Where(s => s.Status == ShiftStatus.Draft).ToList();
        if (drafts.Count == 0)
            throw new BusinessRuleException("nothing_to_publish", "In dieser Woche gibt es keine unveröffentlichten Schichten.");

        var issues = (await validation.ValidateAsync(location, shifts, weekStart, ct)).Select(ScheduleValidationBuilder.ToDto).ToList();
        var report = Report(issues);
        if (report.Errors > 0)
            throw new BusinessRuleException("schedule_has_errors",
                $"Der Schichtplan enthält {report.Errors} {(report.Errors == 1 ? "Fehler" : "Fehler")}, die vor dem Veröffentlichen behoben werden müssen.")
            { Extensions = new { issues } };
        if (report.Warnings > 0 && !r.AcknowledgeWarnings)
            throw new BusinessRuleException("schedule_requires_confirmation",
                $"Der Schichtplan enthält {report.Warnings} {(report.Warnings == 1 ? "Hinweis" : "Hinweise")}. Bitte prüfen und bestätigen Sie diese vor dem Veröffentlichen.")
            { Extensions = new { issues } };

        var now = clock.UtcNow;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        foreach (var s in drafts) { s.Publish(now); s.UpdatedAt = now; }
        var publication = new ShiftPublication
        {
            TenantId = location.TenantId, LocationId = location.Id, WeekStart = weekStart, Action = PublicationAction.Published,
            CreatedAt = now, UserId = access.UserId, ShiftCount = drafts.Count, WarningCount = report.Warnings
        };
        db.ShiftPublications.Add(publication);

        var affected = drafts.Where(s => s.EmployeeId is not null).GroupBy(s => s.EmployeeId!.Value).ToDictionary(g => g.Key, g => g.Count());
        var userMap = await db.Employees.Where(e => affected.Keys.Contains(e.Id) && e.UserId != null).ToDictionaryAsync(e => e.Id, e => e.UserId!.Value, ct);
        var week = System.Globalization.ISOWeek.GetWeekOfYear(weekStart.ToDateTime(TimeOnly.MinValue));
        foreach (var (employeeId, count) in affected)
        {
            if (!userMap.TryGetValue(employeeId, out var userId)) continue;
            notifier.Notify(location.TenantId, [userId], NotificationTypes.SchedulePublished, $"Schichtplan KW {week} veröffentlicht",
                $"{location.Name}: Sie haben {count} {(count == 1 ? "neue Schicht" : "neue Schichten")} in der Woche ab {weekStart.ToString("dd.MM.yyyy", Messages.German)}.",
                "/meine-schichten", $"pub:{publication.Id}");
        }
        audit.Log("schedule.published", "Location", location.Id, new { weekStart, shifts = drafts.Count, warnings = report.Warnings });
        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw ConcurrencyErrors.Stale("Der Schichtplan");
        }
        return new PublishResult(drafts.Count, userMap.Count, issues);
    }

    /// <summary>
    /// Policy: unpublishing reverts only shifts that have not started yet back to draft. Employees are informed.
    /// Shifts in the past remain published to keep the record of what was planned.
    /// </summary>
    public async Task<int> UnpublishWeekAsync(UnpublishWeekRequest r, CancellationToken ct)
    {
        access.Require(ManagerPermissions.PublishSchedules, r.LocationId);
        access.EnsureWritable();
        var weekStart = ZonedTime.WeekStart(r.WeekStart);
        var (location, shifts) = await LoadWeekAsync(r.LocationId, weekStart, ct);
        var now = clock.UtcNow;
        var target = shifts.Where(s => s.Status == ShiftStatus.Published && s.StartUtc > now).ToList();
        if (target.Count == 0) throw new BusinessRuleException("nothing_to_unpublish", "Es gibt keine zukünftigen veröffentlichten Schichten in dieser Woche.");

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var ids = target.Select(s => s.Id).ToList();
        foreach (var swap in await db.ShiftSwaps.Where(s => ids.Contains(s.ShiftId) && (s.Status == SwapStatus.Pending || s.Status == SwapStatus.AwaitingApproval)).ToListAsync(ct))
            swap.Invalidate();
        foreach (var s in target) { s.Unpublish(); s.UpdatedAt = now; }
        var publication = new ShiftPublication
        {
            TenantId = location.TenantId, LocationId = location.Id, WeekStart = weekStart, Action = PublicationAction.Unpublished,
            CreatedAt = now, UserId = access.UserId, ShiftCount = target.Count
        };
        db.ShiftPublications.Add(publication);
        var empIds = target.Where(s => s.EmployeeId is not null).Select(s => s.EmployeeId!.Value).Distinct().ToList();
        var users = await db.Employees.Where(e => empIds.Contains(e.Id) && e.UserId != null).Select(e => e.UserId!.Value).ToListAsync(ct);
        notifier.Notify(location.TenantId, users, NotificationTypes.ScheduleUnpublished, "Schichtplan wird überarbeitet",
            $"{location.Name}: Der Schichtplan für die Woche ab {weekStart.ToString("dd.MM.yyyy", Messages.German)} wird überarbeitet. Sie werden informiert, sobald er erneut veröffentlicht ist.",
            "/meine-schichten", $"unpub:{publication.Id}");
        audit.Log("schedule.unpublished", "Location", location.Id, new { weekStart, shifts = target.Count });
        try
        {
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (DbUpdateConcurrencyException) { throw ConcurrencyErrors.Stale("Der Schichtplan"); }
        return target.Count;
    }

    public async Task<CopyResult> CopyWeekAsync(CopyWeekRequest r, CancellationToken ct)
    {
        access.Require(ManagerPermissions.ManageSchedules, r.LocationId);
        access.EnsureWritable();
        var (location, source) = await LoadWeekAsync(r.LocationId, r.SourceWeekStart, ct);
        var offset = r.TargetWeekStart.DayNumber - r.SourceWeekStart.DayNumber;
        return await CopyAsync(location, source, offset, r.IncludeAssignments, "schedule.week_copied", ct);
    }

    public async Task<CopyResult> CopyDayAsync(CopyDayRequest r, CancellationToken ct)
    {
        access.Require(ManagerPermissions.ManageSchedules, r.LocationId);
        access.EnsureWritable();
        var location = await db.Locations.SingleOrDefaultAsync(l => l.Id == r.LocationId, ct) ?? throw new NotFoundException();
        var source = await db.Shifts.Where(s => s.LocationId == r.LocationId && s.LocalDate == r.SourceDate && s.Status != ShiftStatus.Cancelled).ToListAsync(ct);
        return await CopyAsync(location, source, r.TargetDate.DayNumber - r.SourceDate.DayNumber, r.IncludeAssignments, "schedule.day_copied", ct);
    }

    private async Task<CopyResult> CopyAsync(RestaurantLocation location, List<Shift> source, int dayOffset, bool includeAssignments, string auditAction, CancellationToken ct)
    {
        if (source.Count == 0) throw new BusinessRuleException("nothing_to_copy", "Im Quellzeitraum gibt es keine Schichten.");
        var zone = ZonedTime.Find(location.TimeZoneId);
        var empIds = source.Where(s => s.EmployeeId is not null).Select(s => s.EmployeeId!.Value).Distinct().ToList();
        var assignable = includeAssignments
            ? (await db.Employees.Where(e => empIds.Contains(e.Id) && (e.Status == EmployeeStatus.Active || e.Status == EmployeeStatus.Invited)
                                             && e.Locations.Any(l => l.LocationId == location.Id)).Select(e => e.Id).ToListAsync(ct)).ToHashSet()
            : [];
        var now = clock.UtcNow;
        var skipped = 0;
        var created = 0;
        foreach (var s in source)
        {
            var startLocal = ZonedTime.ToLocal(s.StartUtc, zone);
            var endLocal = ZonedTime.ToLocal(s.EndUtc, zone);
            var date = s.LocalDate.AddDays(dayOffset);
            DateTime startUtc, endUtc;
            try { (startUtc, endUtc) = ZonedTime.Interval(date, TimeOnly.FromDateTime(startLocal), TimeOnly.FromDateTime(endLocal), zone); }
            catch (Domain.Common.DomainException) { skipped++; continue; } // falls into a DST gap
            Guid? employee = null;
            if (includeAssignments && s.EmployeeId is { } e)
            {
                if (assignable.Contains(e)) employee = e; else skipped++;
            }
            db.Shifts.Add(new Shift
            {
                TenantId = location.TenantId, LocationId = location.Id, EmployeeId = employee, JobRoleId = s.JobRoleId,
                StartUtc = startUtc, EndUtc = endUtc, LocalDate = date, BreakMinutes = s.BreakMinutes, Notes = s.Notes,
                Status = ShiftStatus.Draft, CreatedByUserId = access.UserId, CreatedAt = now, UpdatedAt = now
            });
            created++;
        }
        audit.Log(auditAction, "Location", location.Id, new { created, dayOffset });
        await db.SaveChangesAsync(ct);
        return new CopyResult(created, skipped);
    }

    private async Task<(RestaurantLocation, List<Shift>)> LoadWeekAsync(Guid locationId, DateOnly weekStart, CancellationToken ct)
    {
        var location = await db.Locations.SingleOrDefaultAsync(l => l.Id == locationId, ct) ?? throw new NotFoundException();
        var end = weekStart.AddDays(6);
        var shifts = await db.Shifts.Where(s => s.LocationId == locationId && s.LocalDate >= weekStart && s.LocalDate <= end && s.Status != ShiftStatus.Cancelled)
            .ToListAsync(ct);
        return (location, shifts);
    }

    private static ValidationReportDto Report(List<IssueDto> issues) => new(issues,
        issues.Count(i => i.Severity == nameof(IssueSeverity.Error)),
        issues.Count(i => i.Severity == nameof(IssueSeverity.Warning)),
        issues.Count(i => i.Severity == nameof(IssueSeverity.Info)));

    private static DateOnly Max(DateOnly a, DateOnly b) => a > b ? a : b;
    private static DateOnly Min(DateOnly a, DateOnly b) => a < b ? a : b;
}
