using GastroTeam.Application.Common;
using GastroTeam.Application.Features.Scheduling;
using GastroTeam.Application.Localization;
using GastroTeam.Domain.Common;
using GastroTeam.Domain.Entities;
using GastroTeam.Domain.Scheduling;
using FluentValidation;
using Microsoft.EntityFrameworkCore;

namespace GastroTeam.Application.Features.Leave;

public sealed record LeaveRequestDto(
    Guid Id, Guid EmployeeId, string EmployeeName, LeaveType Type, DateOnly StartDate, DateOnly EndDate, int Days,
    string? Note, LeaveStatus Status, string? DecisionReason, string? DecidedByName, DateTime? DecidedAt, DateTime CreatedAt,
    string Version, bool CanCancel, bool CanDecide);

public sealed record LeaveQuery(LeaveStatus? Status = null, Guid? EmployeeId = null, Guid? LocationId = null,
    DateOnly? From = null, DateOnly? To = null, bool Mine = false, int Page = 1, int PageSize = 25);

public sealed record CreateLeaveRequest(LeaveType Type, DateOnly StartDate, DateOnly EndDate, string? Note);
public sealed record DecideLeaveRequest(string Version, string? Reason);
public sealed record LeaveConflictDto(IReadOnlyList<ShiftDto> Shifts, IReadOnlyList<LeaveRequestDto> OverlappingRequests);

public sealed class CreateLeaveRequestValidator : AbstractValidator<CreateLeaveRequest>
{
    public CreateLeaveRequestValidator()
    {
        RuleFor(x => x.Type).IsInEnum();
        RuleFor(x => x.EndDate).GreaterThanOrEqualTo(x => x.StartDate).WithMessage("Das Enddatum muss am oder nach dem Startdatum liegen.");
        RuleFor(x => x).Must(x => x.EndDate.DayNumber - x.StartDate.DayNumber <= 365).WithMessage("Ein Antrag darf höchstens ein Jahr umfassen.");
        RuleFor(x => x.Note).MaximumLength(500);
    }
}

public sealed class LeaveService(IAppDbContext db, Access access, AuditLogger audit, Notifier notifier, IClock clock, ShiftService shifts)
{
    private static readonly Dictionary<LeaveType, string> Labels = new()
    {
        [LeaveType.Vacation] = "Urlaub", [LeaveType.Sick] = "Krankmeldung", [LeaveType.Unpaid] = "Unbezahlter Urlaub",
        [LeaveType.Training] = "Fortbildung", [LeaveType.Other] = "Sonstige Abwesenheit"
    };

    private IQueryable<LeaveRequest> ManagedScope()
    {
        var c = access.Context;
        if (c.IsOwner) return db.LeaveRequests;
        var managed = c.ManagedLocationIds;
        return db.LeaveRequests.Where(l => l.Employee!.Locations.Any(x => managed.Contains(x.LocationId)));
    }

    public async Task<PagedResult<LeaveRequestDto>> ListAsync(LeaveQuery q, CancellationToken ct)
    {
        _ = access.TenantId;
        IQueryable<LeaveRequest> query;
        if (q.Mine || !access.Context.IsManagerOrOwner)
        {
            var self = access.RequireEmployee();
            query = db.LeaveRequests.Where(l => l.EmployeeId == self);
        }
        else
        {
            query = ManagedScope();
            if (q.EmployeeId is { } emp) query = query.Where(l => l.EmployeeId == emp);
            if (q.LocationId is { } loc) query = query.Where(l => l.Employee!.Locations.Any(x => x.LocationId == loc));
        }
        if (q.Status is { } st) query = query.Where(l => l.Status == st);
        if (q.From is { } from) query = query.Where(l => l.EndDate >= from);
        if (q.To is { } to) query = query.Where(l => l.StartDate <= to);

        var page = await query.Include(l => l.Employee)
            .OrderBy(l => l.Status == LeaveStatus.Pending ? 0 : 1).ThenByDescending(l => l.StartDate)
            .ToPagedAsync(q.Page, q.PageSize, ct);
        var deciders = await DeciderNamesAsync(page.Items, ct);
        return new PagedResult<LeaveRequestDto>(page.Items.Select(l => ToDto(l, deciders)).ToList(), page.Page, page.PageSize, page.TotalCount);
    }

    public async Task<LeaveRequestDto> CreateAsync(CreateLeaveRequest r, CancellationToken ct)
    {
        access.EnsureWritable();
        var employeeId = access.RequireEmployee();
        var today = DateOnly.FromDateTime(clock.UtcNow);
        if (r.Type != LeaveType.Sick && r.StartDate < today)
            throw RequestValidationException.For("startDate", "Urlaub kann nicht rückwirkend beantragt werden.");
        if (r.StartDate < today.AddDays(-30))
            throw RequestValidationException.For("startDate", "Das Startdatum liegt zu weit in der Vergangenheit.");
        if (await db.LeaveRequests.AnyAsync(l => l.EmployeeId == employeeId && (l.Status == LeaveStatus.Pending || l.Status == LeaveStatus.Approved)
                                                  && l.StartDate <= r.EndDate && l.EndDate >= r.StartDate, ct))
            throw new ConflictException("leave_overlap", "Für diesen Zeitraum gibt es bereits einen offenen oder genehmigten Antrag.");

        var now = clock.UtcNow;
        var leave = new LeaveRequest
        {
            TenantId = access.TenantId, EmployeeId = employeeId, Type = r.Type, StartDate = r.StartDate, EndDate = r.EndDate,
            Note = r.Note.NullIfBlank(), CreatedAt = now, UpdatedAt = now
        };
        db.LeaveRequests.Add(leave);
        var employee = await db.Employees.SingleAsync(e => e.Id == employeeId, ct);
        var managers = await notifier.ManagersForEmployeeAsync(leave.TenantId, employeeId, ManagerPermissions.ApproveLeave, ct);
        notifier.Notify(leave.TenantId, managers, NotificationTypes.LeaveSubmitted, "Neuer Antrag",
            $"{employee.FullName} hat {Labels[r.Type]} vom {Fmt(r.StartDate)} bis {Fmt(r.EndDate)} beantragt.", "/urlaub", $"leave:{leave.Id}");
        audit.Log("leave.created", "LeaveRequest", leave.Id, new { r.Type, r.StartDate, r.EndDate });
        await db.SaveChangesAsync(ct);
        return await GetAsync(leave.Id, ct);
    }

    public async Task<LeaveRequestDto> GetAsync(Guid id, CancellationToken ct)
    {
        var leave = await LoadVisibleAsync(id, ct);
        return ToDto(leave, await DeciderNamesAsync([leave], ct));
    }

    public async Task<LeaveConflictDto> ConflictsAsync(Guid id, CancellationToken ct)
    {
        access.Require(ManagerPermissions.ApproveLeave);
        var leave = await ManagedScope().Include(l => l.Employee).SingleOrDefaultAsync(l => l.Id == id, ct) ?? throw new NotFoundException();
        var conflicting = await db.Shifts.Include(s => s.Employee).Include(s => s.JobRole).Include(s => s.Location)
            .Where(s => s.EmployeeId == leave.EmployeeId && s.Status != ShiftStatus.Cancelled && s.LocalDate >= leave.StartDate && s.LocalDate <= leave.EndDate)
            .OrderBy(s => s.StartUtc).AsSplitQuery().ToListAsync(ct);
        var locationIds = await db.EmployeeLocations.Where(x => x.EmployeeId == leave.EmployeeId).Select(x => x.LocationId).ToListAsync(ct);
        // Colleagues at the same locations who are already approved to be away in this period.
        var overlapping = await db.LeaveRequests.Include(l => l.Employee)
            .Where(l => l.Id != id && l.EmployeeId != leave.EmployeeId && l.Status == LeaveStatus.Approved
                        && l.StartDate <= leave.EndDate && l.EndDate >= leave.StartDate
                        && l.Employee!.Locations.Any(x => locationIds.Contains(x.LocationId)))
            .ToListAsync(ct);
        var deciders = await DeciderNamesAsync(overlapping, ct);
        return new LeaveConflictDto(await shifts.MapAsync(conflicting, ct), overlapping.Select(l => ToDto(l, deciders) with { Note = null }).ToList());
    }

    public async Task<LeaveRequestDto> ApproveAsync(Guid id, DecideLeaveRequest r, CancellationToken ct)
    {
        access.Require(ManagerPermissions.ApproveLeave);
        access.EnsureWritable();
        var leave = await ManagedScope().Include(l => l.Employee).SingleOrDefaultAsync(l => l.Id == id, ct) ?? throw new NotFoundException();
        if (leave.EmployeeId == access.Context.EmployeeId && !access.Context.IsOwner)
            throw new ForbiddenException("Eigene Anträge müssen von einer anderen berechtigten Person genehmigt werden.");
        db.ApplyClientVersion(leave, r.Version);
        if (await db.LeaveRequests.AnyAsync(l => l.Id != id && l.EmployeeId == leave.EmployeeId && l.Status == LeaveStatus.Approved
                                                 && l.StartDate <= leave.EndDate && l.EndDate >= leave.StartDate, ct))
            throw new ConflictException("leave_overlap", "Für diesen Zeitraum ist bereits ein Antrag genehmigt.");
        try { leave.Approve(access.UserId, clock.UtcNow); }
        catch (DomainException ex) { throw new BusinessRuleException(ex.Code, Messages.Get(ex.Code)); }
        leave.UpdatedAt = clock.UtcNow;
        NotifyEmployee(leave, "Antrag genehmigt", $"Ihr Antrag ({Labels[leave.Type]}, {Fmt(leave.StartDate)}–{Fmt(leave.EndDate)}) wurde genehmigt.");
        audit.Log("leave.approved", "LeaveRequest", leave.Id);
        await SaveAsync(ct);
        return await GetAsync(id, ct);
    }

    public async Task<LeaveRequestDto> RejectAsync(Guid id, DecideLeaveRequest r, CancellationToken ct)
    {
        access.Require(ManagerPermissions.ApproveLeave);
        access.EnsureWritable();
        var leave = await ManagedScope().Include(l => l.Employee).SingleOrDefaultAsync(l => l.Id == id, ct) ?? throw new NotFoundException();
        if (leave.EmployeeId == access.Context.EmployeeId && !access.Context.IsOwner)
            throw new ForbiddenException("Eigene Anträge müssen von einer anderen berechtigten Person bearbeitet werden.");
        db.ApplyClientVersion(leave, r.Version);
        if (string.IsNullOrWhiteSpace(r.Reason)) throw RequestValidationException.For("reason", "Bitte geben Sie einen Grund für die Ablehnung an.");
        if (r.Reason.Length > 500) throw RequestValidationException.For("reason", "Der Grund ist zu lang.");
        try { leave.Reject(access.UserId, r.Reason, clock.UtcNow); }
        catch (DomainException ex) { throw new BusinessRuleException(ex.Code, Messages.Get(ex.Code)); }
        leave.UpdatedAt = clock.UtcNow;
        NotifyEmployee(leave, "Antrag abgelehnt", $"Ihr Antrag ({Labels[leave.Type]}, {Fmt(leave.StartDate)}–{Fmt(leave.EndDate)}) wurde abgelehnt. Grund: {leave.DecisionReason}");
        audit.Log("leave.rejected", "LeaveRequest", leave.Id);
        await SaveAsync(ct);
        return await GetAsync(id, ct);
    }

    public async Task<LeaveRequestDto> CancelAsync(Guid id, DecideLeaveRequest r, CancellationToken ct)
    {
        access.EnsureWritable();
        var leave = await LoadVisibleAsync(id, ct);
        var isOwn = leave.EmployeeId == access.Context.EmployeeId;
        var isManager = access.Has(ManagerPermissions.ApproveLeave) && !isOwn;
        if (!isOwn && !isManager) throw new ForbiddenException();
        db.ApplyClientVersion(leave, r.Version);
        try { leave.Cancel(access.UserId, isManager, DateOnly.FromDateTime(clock.UtcNow), clock.UtcNow); }
        catch (DomainException ex) { throw new BusinessRuleException(ex.Code, Messages.Get(ex.Code)); }
        leave.UpdatedAt = clock.UtcNow;
        if (isManager) NotifyEmployee(leave, "Abwesenheit storniert", $"Ihre Abwesenheit {Fmt(leave.StartDate)}–{Fmt(leave.EndDate)} wurde storniert.");
        audit.Log("leave.cancelled", "LeaveRequest", leave.Id);
        await SaveAsync(ct);
        return await GetAsync(id, ct);
    }

    private async Task<LeaveRequest> LoadVisibleAsync(Guid id, CancellationToken ct)
    {
        _ = access.TenantId;
        var leave = await db.LeaveRequests.Include(l => l.Employee).ThenInclude(e => e!.Locations).SingleOrDefaultAsync(l => l.Id == id, ct)
                    ?? throw new NotFoundException();
        var own = leave.EmployeeId == access.Context.EmployeeId;
        var managed = access.Context.IsOwner || (access.Context.IsManagerOrOwner && access.ManagesAny(leave.Employee!.Locations.Select(l => l.LocationId)));
        if (!own && !managed) throw new NotFoundException();
        return leave;
    }

    private void NotifyEmployee(LeaveRequest leave, string title, string body)
    {
        if (leave.Employee?.UserId is { } userId)
            notifier.Notify(leave.TenantId, [userId], NotificationTypes.LeaveDecided, title, body, "/urlaub");
    }

    private async Task SaveAsync(CancellationToken ct)
    {
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { throw ConcurrencyErrors.Stale("Der Antrag"); }
    }

    private async Task<Dictionary<Guid, string>> DeciderNamesAsync(IEnumerable<LeaveRequest> items, CancellationToken ct)
    {
        var ids = items.Where(i => i.DecidedByUserId is not null).Select(i => i.DecidedByUserId!.Value).Distinct().ToList();
        return await db.Users.Where(u => ids.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.FirstName + " " + u.LastName, ct);
    }

    private LeaveRequestDto ToDto(LeaveRequest l, Dictionary<Guid, string> deciders)
    {
        var own = l.EmployeeId == access.Context.EmployeeId;
        var canDecide = !own || access.Context.IsOwner;
        var isManager = access.Has(ManagerPermissions.ApproveLeave);
        // Sick-leave notes are visible only to the employee and to people who decide on leave.
        var note = l.Type == LeaveType.Sick && !own && !isManager ? null : l.Note;
        return new LeaveRequestDto(l.Id, l.EmployeeId, l.Employee?.FullName ?? "", l.Type, l.StartDate, l.EndDate, l.Days, note, l.Status,
            l.DecisionReason, l.DecidedByUserId is { } d ? deciders.GetValueOrDefault(d) : null, l.DecidedAt, l.CreatedAt, l.RowVersion.ToVersion(),
            CanCancel: (own && l.Status == LeaveStatus.Pending) || (isManager && !own && l.Status is LeaveStatus.Pending or LeaveStatus.Approved),
            CanDecide: isManager && canDecide && l.Status == LeaveStatus.Pending);
    }

    private static string Fmt(DateOnly d) => d.ToString("dd.MM.yyyy", Messages.German);
}
