using GastroTeam.Application.Common;
using GastroTeam.Application.Features.Invitations;
using GastroTeam.Domain.Common;
using GastroTeam.Domain.Entities;
using FluentValidation;
using Microsoft.EntityFrameworkCore;

namespace GastroTeam.Application.Features.Employees;

public sealed record EmployeeDto(
    Guid Id, string FirstName, string LastName, string FullName, string? Email, string? Phone, string? ProfileImageUrl,
    Guid? JobRoleId, string? JobRoleName, string? JobRoleColor, EmployeeStatus Status, decimal? ContractHoursPerWeek,
    DateOnly? EmploymentStartDate, DateOnly? EmploymentEndDate, string PreferredLanguage, IReadOnlyList<Guid> LocationIds,
    bool HasAccount, DateTime? InvitationExpiresAt, string? Notes, string Version, DateTime CreatedAt, DateTime UpdatedAt);

public sealed record EmployeeQuery(
    string? Search = null, Guid? LocationId = null, EmployeeStatus? Status = null, Guid? JobRoleId = null,
    string? Sort = "name", bool Desc = false, int Page = 1, int PageSize = 25);

public sealed record SaveEmployeeRequest(
    string FirstName, string LastName, string? Email, string? Phone, Guid? JobRoleId, decimal? ContractHoursPerWeek,
    DateOnly? EmploymentStartDate, DateOnly? EmploymentEndDate, string? PreferredLanguage, IReadOnlyList<Guid> LocationIds,
    string? Notes, bool SendInvitation = false, string? Version = null);

public sealed record DeactivateEmployeeRequest(DateOnly? EndDate, string Version);
public sealed record DeactivateResult(EmployeeDto Employee, int UnassignedFutureShifts);

/// <summary>Minimal colleague info for scheduling-related features visible to employees.</summary>
public sealed record ColleagueDto(Guid Id, string FullName, string? JobRoleName);

public sealed class SaveEmployeeRequestValidator : AbstractValidator<SaveEmployeeRequest>
{
    public SaveEmployeeRequestValidator()
    {
        RuleFor(x => x.FirstName).NotEmpty().WithMessage("Bitte geben Sie einen Vornamen an.").MaximumLength(100);
        RuleFor(x => x.LastName).NotEmpty().WithMessage("Bitte geben Sie einen Nachnamen an.").MaximumLength(100);
        RuleFor(x => x.Email).EmailAddress().WithMessage("Bitte geben Sie eine gÃ¼ltige E-Mail-Adresse an.").MaximumLength(256)
            .When(x => !string.IsNullOrWhiteSpace(x.Email));
        RuleFor(x => x.Email).NotEmpty().When(x => x.SendInvitation).WithMessage("FÃ¼r eine Einladung wird eine E-Mail-Adresse benÃ¶tigt.");
        RuleFor(x => x.Phone).MaximumLength(40).Matches(@"^[0-9 +()/\-]*$").WithMessage("Die Telefonnummer enthÃ¤lt ungÃ¼ltige Zeichen.");
        RuleFor(x => x.ContractHoursPerWeek).InclusiveBetween(0, 60).When(x => x.ContractHoursPerWeek is not null)
            .WithMessage("Die Wochenstunden mÃ¼ssen zwischen 0 und 60 liegen.");
        RuleFor(x => x.EmploymentEndDate).GreaterThanOrEqualTo(x => x.EmploymentStartDate)
            .When(x => x.EmploymentStartDate is not null && x.EmploymentEndDate is not null)
            .WithMessage("Das Austrittsdatum muss nach dem Eintrittsdatum liegen.");
        RuleFor(x => x.LocationIds).NotEmpty().WithMessage("Bitte ordnen Sie mindestens einen Standort zu.");
        RuleFor(x => x.Notes).MaximumLength(1000);
    }
}

public sealed class EmployeeService(
    IAppDbContext db, Access access, AuditLogger audit, IClock clock, InvitationService invitations)
{
    private IQueryable<Employee> Scoped()
    {
        var c = access.Context;
        if (c.IsOwner) return db.Employees;
        var managed = c.ManagedLocationIds;
        return db.Employees.Where(e => e.Locations.Any(l => managed.Contains(l.LocationId)));
    }

    public async Task<PagedResult<EmployeeDto>> ListAsync(EmployeeQuery q, CancellationToken ct)
    {
        access.RequireManager();
        var query = Scoped().Include(e => e.JobRole).Include(e => e.Locations).AsQueryable();
        if (!string.IsNullOrWhiteSpace(q.Search))
        {
            var s = q.Search.Trim();
            query = query.Where(e => e.FirstName.Contains(s) || e.LastName.Contains(s) || (e.Email != null && e.Email.Contains(s)) ||
                                     (e.FirstName + " " + e.LastName).Contains(s));
        }
        if (q.LocationId is { } loc) query = query.Where(e => e.Locations.Any(l => l.LocationId == loc));
        query = q.Status is { } status ? query.Where(e => e.Status == status) : query.Where(e => e.Status != EmployeeStatus.Archived);
        if (q.JobRoleId is { } role) query = query.Where(e => e.JobRoleId == role);

        query = (q.Sort?.ToLowerInvariant(), q.Desc) switch
        {
            ("role", false) => query.OrderBy(e => e.JobRole!.Name).ThenBy(e => e.LastName),
            ("role", true) => query.OrderByDescending(e => e.JobRole!.Name).ThenBy(e => e.LastName),
            ("status", false) => query.OrderBy(e => e.Status).ThenBy(e => e.LastName),
            ("status", true) => query.OrderByDescending(e => e.Status).ThenBy(e => e.LastName),
            (_, true) => query.OrderByDescending(e => e.LastName).ThenByDescending(e => e.FirstName),
            _ => query.OrderBy(e => e.LastName).ThenBy(e => e.FirstName)
        };

        var page = await query.AsSplitQuery().ToPagedAsync(q.Page, q.PageSize, ct);
        var invites = await PendingInvitationsAsync(page.Items.Select(e => e.Id).ToList(), ct);
        return new PagedResult<EmployeeDto>(page.Items.Select(e => ToDto(e, invites.GetValueOrDefault(e.Id))).ToList(), page.Page, page.PageSize, page.TotalCount);
    }

    public async Task<EmployeeDto> GetAsync(Guid id, CancellationToken ct)
    {
        _ = access.TenantId;
        var isSelf = access.Context.EmployeeId == id;
        if (!isSelf) access.RequireManager();
        var source = isSelf ? db.Employees : Scoped();
        var e = await source.Include(x => x.JobRole).Include(x => x.Locations).AsSplitQuery()
            .SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        var invites = await PendingInvitationsAsync([e.Id], ct);
        var dto = ToDto(e, invites.GetValueOrDefault(e.Id));
        // Internal manager notes are not shown to the employee themself.
        return isSelf && !access.Context.IsManagerOrOwner ? dto with { Notes = null } : dto;
    }

    public async Task<EmployeeDto> CreateAsync(SaveEmployeeRequest r, CancellationToken ct)
    {
        access.Require(ManagerPermissions.ManageEmployees);
        access.EnsureWritable();
        foreach (var loc in r.LocationIds.Distinct()) access.RequireManagedLocation(loc);
        await EnsureReferencesAsync(r, ct);
        var active = await db.Employees.CountAsync(e => e.Status == EmployeeStatus.Active || e.Status == EmployeeStatus.Invited, ct);
        EnsureEmployeeLimit(active);

        var now = clock.UtcNow;
        var e = new Employee { TenantId = access.TenantId, CreatedAt = now, Status = EmployeeStatus.Active };
        await ApplyAsync(e, r, now, ct);
        e.Locations = r.LocationIds.Distinct().Select(l => new EmployeeLocationAssignment { TenantId = e.TenantId, EmployeeId = e.Id, LocationId = l }).ToList();
        db.Employees.Add(e);
        audit.Log("employee.created", "Employee", e.Id);
        await db.SaveChangesAsync(ct);

        if (r.SendInvitation) await invitations.InviteEmployeeAsync(e.Id, ct);
        return await GetAsync(e.Id, ct);
    }

    public async Task<EmployeeDto> UpdateAsync(Guid id, SaveEmployeeRequest r, CancellationToken ct)
    {
        access.Require(ManagerPermissions.ManageEmployees);
        access.EnsureWritable();
        var e = await Scoped().Include(x => x.Locations).SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (e.Status == EmployeeStatus.Archived) throw new BusinessRuleException("employee_archived", "Archivierte Mitarbeitende kÃ¶nnen nicht mehr geÃ¤ndert werden.");
        db.ApplyClientVersion(e, r.Version);
        await EnsureReferencesAsync(r, ct);

        var managed = access.Context.ManagedLocationIds;
        var requested = r.LocationIds.Distinct().ToHashSet();
        foreach (var loc in requested.Where(l => !e.Locations.Any(x => x.LocationId == l))) access.RequireManagedLocation(loc);
        // Assignments outside the manager's scope are kept untouched.
        var removed = e.Locations.Where(x => !requested.Contains(x.LocationId) && (access.Context.IsOwner || managed.Contains(x.LocationId))).ToList();
        foreach (var x in removed) e.Locations.Remove(x);
        foreach (var loc in requested.Where(l => e.Locations.All(x => x.LocationId != l)))
            e.Locations.Add(new EmployeeLocationAssignment { TenantId = e.TenantId, EmployeeId = e.Id, LocationId = loc });
        if (e.Locations.Count == 0) throw RequestValidationException.For("locationIds", "Bitte ordnen Sie mindestens einen Standort zu.");

        var emailChanged = !string.Equals(e.Email, r.Email.NullIfBlank(), StringComparison.OrdinalIgnoreCase);
        if (emailChanged && e.UserId is not null)
            throw RequestValidationException.For("email", "Die E-Mail-Adresse eines verknÃ¼pften Kontos kann nur von der Person selbst geÃ¤ndert werden.");

        await ApplyAsync(e, r, clock.UtcNow, ct);
        audit.Log("employee.updated", "Employee", e.Id);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { throw ConcurrencyErrors.Stale("Das Mitarbeiterprofil"); }
        return await GetAsync(e.Id, ct);
    }

    public async Task<DeactivateResult> DeactivateAsync(Guid id, DeactivateEmployeeRequest r, CancellationToken ct)
    {
        access.Require(ManagerPermissions.ManageEmployees);
        access.EnsureWritable();
        var e = await Scoped().SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        db.ApplyClientVersion(e, r.Version);
        if (e.Id == access.Context.EmployeeId) throw new BusinessRuleException("self_deactivation", "Sie kÃ¶nnen sich nicht selbst deaktivieren.");
        var now = clock.UtcNow;
        try { e.Deactivate(r.EndDate); }
        catch (DomainException ex) { throw new BusinessRuleException(ex.Code, Localization.Messages.Get(ex.Code)); }
        e.UpdatedAt = now;

        // Future shifts are unassigned so they show up as open shifts instead of silently staying planned.
        var future = await db.Shifts.Where(s => s.EmployeeId == e.Id && s.StartUtc > now && s.Status != ShiftStatus.Cancelled).ToListAsync(ct);
        foreach (var s in future) { s.EmployeeId = null; s.UpdatedAt = now; }
        foreach (var swap in await db.ShiftSwaps.Where(s => (s.RequesterEmployeeId == e.Id || s.TargetEmployeeId == e.Id || s.AcceptedByEmployeeId == e.Id)
                                                            && (s.Status == SwapStatus.Pending || s.Status == SwapStatus.AwaitingApproval)).ToListAsync(ct))
            swap.Invalidate();
        foreach (var inv in await db.Invitations.Where(i => i.EmployeeId == e.Id && i.AcceptedAt == null && i.RevokedAt == null).ToListAsync(ct))
            inv.RevokedAt = now;
        if (e.UserId is { } userId)
        {
            var membership = await db.Memberships.SingleOrDefaultAsync(m => m.UserId == userId && m.Role == MembershipRole.Employee, ct);
            if (membership is not null) membership.IsActive = false;
        }
        audit.Log("employee.deactivated", "Employee", e.Id, new { unassigned = future.Count });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { throw ConcurrencyErrors.Stale("Das Mitarbeiterprofil"); }
        return new DeactivateResult(await GetAsync(e.Id, ct), future.Count);
    }

    public async Task<EmployeeDto> ReactivateAsync(Guid id, CancellationToken ct)
    {
        access.Require(ManagerPermissions.ManageEmployees);
        access.EnsureWritable();
        var e = await Scoped().SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        if (e.Status is EmployeeStatus.Active or EmployeeStatus.Invited) return await GetAsync(id, ct);
        var active = await db.Employees.CountAsync(x => x.Status == EmployeeStatus.Active || x.Status == EmployeeStatus.Invited, ct);
        EnsureEmployeeLimit(active);
        try { e.Reactivate(); }
        catch (DomainException ex) { throw new BusinessRuleException(ex.Code, Localization.Messages.Get(ex.Code)); }
        if (e.UserId is { } userId)
        {
            var membership = await db.Memberships.SingleOrDefaultAsync(m => m.UserId == userId, ct);
            if (membership is not null) membership.IsActive = true;
            e.Status = EmployeeStatus.Active;
        }
        e.UpdatedAt = clock.UtcNow;
        audit.Log("employee.reactivated", "Employee", e.Id);
        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }

    /// <summary>Irreversibly removes personal data of an inactive employee (shift history is retained anonymously).</summary>
    public async Task AnonymizeAsync(Guid id, CancellationToken ct)
    {
        access.RequireOwner();
        var e = await db.Employees.SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        try { e.Anonymize(clock.UtcNow); }
        catch (DomainException ex) { throw new BusinessRuleException(ex.Code, Localization.Messages.Get(ex.Code)); }
        await db.AvailabilityExceptions.Where(a => a.EmployeeId == id).ExecuteUpdateAsync(s => s.SetProperty(a => a.Note, (string?)null), ct);
        await db.LeaveRequests.Where(l => l.EmployeeId == id).ExecuteUpdateAsync(s => s.SetProperty(l => l.Note, (string?)null), ct);
        audit.Log("employee.anonymized", "Employee", e.Id);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Data export for an employee record (GDPR access requests handled by the employer).</summary>
    public async Task<object> ExportAsync(Guid id, CancellationToken ct)
    {
        access.RequireOwner();
        var e = await db.Employees.Include(x => x.Locations).Include(x => x.JobRole).SingleOrDefaultAsync(x => x.Id == id, ct) ?? throw new NotFoundException();
        var shifts = await db.Shifts.Where(s => s.EmployeeId == id).OrderBy(s => s.StartUtc)
            .Select(s => new { s.Id, s.LocationId, s.StartUtc, s.EndUtc, s.BreakMinutes, s.Status }).ToListAsync(ct);
        var leave = await db.LeaveRequests.Where(l => l.EmployeeId == id)
            .Select(l => new { l.Type, l.StartDate, l.EndDate, l.Status, l.Note, l.DecisionReason, l.CreatedAt }).ToListAsync(ct);
        var availability = await db.Availability.Where(a => a.EmployeeId == id)
            .Select(a => new { a.DayOfWeek, a.StartTime, a.EndTime, a.Kind, a.ValidFrom, a.ValidTo }).ToListAsync(ct);
        audit.Log("employee.exported", "Employee", e.Id);
        await db.SaveChangesAsync(ct);
        return new
        {
            exportedAt = clock.UtcNow,
            employee = new
            {
                e.FirstName, e.LastName, e.Email, e.Phone, e.Status, e.ContractHoursPerWeek, e.EmploymentStartDate, e.EmploymentEndDate,
                e.PreferredLanguage, jobRole = e.JobRole?.Name, locations = e.Locations.Select(l => l.LocationId), e.CreatedAt
            },
            shifts,
            leaveRequests = leave,
            availability
        };
    }

    /// <summary>Colleagues sharing a location with the current user. Only names and role â€” no contact data.</summary>
    public async Task<IReadOnlyList<ColleagueDto>> ColleaguesAsync(Guid? locationId, CancellationToken ct)
    {
        _ = access.TenantId;
        var visible = access.Context.VisibleLocationIds;
        var locs = locationId is { } l ? (visible.Contains(l) ? [l] : throw new ForbiddenException()) : visible.ToList();
        return await db.Employees
            .Where(e => (e.Status == EmployeeStatus.Active || e.Status == EmployeeStatus.Invited) && e.Locations.Any(x => locs.Contains(x.LocationId)))
            .OrderBy(e => e.FirstName).ThenBy(e => e.LastName)
            .Select(e => new ColleagueDto(e.Id, e.FirstName + " " + e.LastName, e.JobRole != null ? e.JobRole.Name : null))
            .ToListAsync(ct);
    }

    private void EnsureEmployeeLimit(int active)
    {
        try { Entitlements.EnsureCanActivateEmployee(access.Plan, active); }
        catch (DomainException)
        {
            throw new BusinessRuleException("plan_employee_limit",
                $"Ihr Tarif â€ž{access.Plan.Name}â€œ erlaubt hÃ¶chstens {access.Plan.MaxActiveEmployees} aktive Mitarbeitende. Bitte wechseln Sie den Tarif oder deaktivieren Sie ehemalige Mitarbeitende.");
        }
    }

    private async Task EnsureReferencesAsync(SaveEmployeeRequest r, CancellationToken ct)
    {
        if (r.JobRoleId is { } roleId && !await db.JobRoles.AnyAsync(x => x.Id == roleId, ct))
            throw RequestValidationException.For("jobRoleId", "Die Rolle existiert nicht.");
        var ids = r.LocationIds.Distinct().ToList();
        if (await db.Locations.CountAsync(l => ids.Contains(l.Id), ct) != ids.Count)
            throw RequestValidationException.For("locationIds", "Mindestens ein Standort existiert nicht.");
    }

    private async Task ApplyAsync(Employee e, SaveEmployeeRequest r, DateTime now, CancellationToken ct)
    {
        var email = r.Email.NullIfBlank()?.ToLowerInvariant();
        var normalized = email?.ToUpperInvariant();
        if (normalized is not null && await db.Employees.AnyAsync(x => x.Id != e.Id && x.NormalizedEmail == normalized, ct))
            throw new ConflictException("duplicate_email", "Es gibt bereits eine Person mit dieser E-Mail-Adresse in Ihrem Betrieb.");
        e.FirstName = r.FirstName.Trim();
        e.LastName = r.LastName.Trim();
        e.Email = email;
        e.NormalizedEmail = normalized;
        e.Phone = r.Phone.NullIfBlank();
        e.JobRoleId = r.JobRoleId;
        e.ContractHoursPerWeek = r.ContractHoursPerWeek;
        e.EmploymentStartDate = r.EmploymentStartDate;
        e.EmploymentEndDate = r.EmploymentEndDate;
        e.PreferredLanguage = r.PreferredLanguage ?? "de-DE";
        e.Notes = r.Notes.NullIfBlank();
        e.UpdatedAt = now;
    }

    private async Task<Dictionary<Guid, DateTime>> PendingInvitationsAsync(List<Guid> employeeIds, CancellationToken ct)
    {
        var now = clock.UtcNow;
        return await db.Invitations
            .Where(i => i.EmployeeId != null && employeeIds.Contains(i.EmployeeId.Value) && i.AcceptedAt == null && i.RevokedAt == null && i.ExpiresAt > now)
            .GroupBy(i => i.EmployeeId!.Value)
            .Select(g => new { g.Key, ExpiresAt = g.Max(i => i.ExpiresAt) })
            .ToDictionaryAsync(x => x.Key, x => x.ExpiresAt, ct);
    }

    public static EmployeeDto ToDto(Employee e, DateTime? invitationExpires) => new(
        e.Id, e.FirstName, e.LastName, e.FullName, e.Email, e.Phone, e.ProfileImageUrl, e.JobRoleId, e.JobRole?.Name, e.JobRole?.Color,
        e.Status, e.ContractHoursPerWeek, e.EmploymentStartDate, e.EmploymentEndDate, e.PreferredLanguage,
        e.Locations.Select(l => l.LocationId).ToList(), e.UserId is not null, invitationExpires, e.Notes,
        e.RowVersion.ToVersion(), e.CreatedAt, e.UpdatedAt);
}
