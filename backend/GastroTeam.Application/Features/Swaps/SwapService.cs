using GastroTeam.Application.Common;
using GastroTeam.Application.Features.Scheduling;
using GastroTeam.Application.Localization;
using GastroTeam.Domain.Common;
using GastroTeam.Domain.Entities;
using FluentValidation;
using Microsoft.EntityFrameworkCore;

namespace GastroTeam.Application.Features.Swaps;

public sealed record SwapDto(
    Guid Id, ShiftDto Shift, Guid RequesterEmployeeId, string RequesterName, Guid? TargetEmployeeId, string? TargetName,
    Guid? AcceptedByEmployeeId, string? AcceptedByName, SwapStatus Status, string? Message, string? DecisionReason,
    DateTime CreatedAt, DateTime? CompletedAt, string Version,
    bool CanAccept, bool CanDecline, bool CanApprove, bool CanReject, bool CanCancel);

public sealed record CreateSwapRequest(Guid ShiftId, Guid? TargetEmployeeId, string? Message);
public sealed record SwapActionRequest(string Version, string? Reason);
public sealed record EligibleColleagueDto(Guid Id, string FullName, string? JobRoleName, bool HasConflict, string? ConflictReason);

public sealed class CreateSwapRequestValidator : AbstractValidator<CreateSwapRequest>
{
    public CreateSwapRequestValidator()
    {
        RuleFor(x => x.ShiftId).NotEmpty();
        RuleFor(x => x.Message).MaximumLength(300);
    }
}

public sealed class SwapService(IAppDbContext db, Access access, AuditLogger audit, Notifier notifier, IClock clock, ShiftService shifts)
{
    public async Task<IReadOnlyList<SwapDto>> ListAsync(string scope, bool openOnly, CancellationToken ct)
    {
        _ = access.TenantId;
        access.RequireFeature(PlanFeatures.ShiftSwaps);
        var query = db.ShiftSwaps.AsQueryable();
        var me = access.Context.EmployeeId;
        switch (scope)
        {
            case "manage":
                access.Require(ManagerPermissions.ManageSwaps);
                var managed = access.Context.ManagedLocationIds;
                query = query.Where(s => managed.Contains(s.Shift!.LocationId));
                break;
            case "open":
                var mine = access.RequireEmployee();
                var locs = access.Context.EmployeeLocationIds;
                var now = clock.UtcNow;
                query = query.Where(s => s.TargetEmployeeId == null && s.Status == SwapStatus.Pending && s.RequesterEmployeeId != mine
                                         && locs.Contains(s.Shift!.LocationId) && s.Shift.StartUtc > now);
                break;
            default:
                var self = access.RequireEmployee();
                query = query.Where(s => s.RequesterEmployeeId == self || s.TargetEmployeeId == self || s.AcceptedByEmployeeId == self);
                break;
        }
        if (openOnly) query = query.Where(s => s.Status == SwapStatus.Pending || s.Status == SwapStatus.AwaitingApproval);
        var list = await Include(query).OrderByDescending(s => s.CreatedAt).Take(200).AsSplitQuery().ToListAsync(ct);
        var settings = await db.TenantSettings.SingleAsync(ct);
        var result = new List<SwapDto>();
        foreach (var s in list) result.Add(await ToDtoAsync(s, settings, ct));
        _ = me;
        return result;
    }

    public async Task<IReadOnlyList<EligibleColleagueDto>> EligibleColleaguesAsync(Guid shiftId, CancellationToken ct)
    {
        access.RequireFeature(PlanFeatures.ShiftSwaps);
        var me = access.RequireEmployee();
        var shift = await db.Shifts.SingleOrDefaultAsync(s => s.Id == shiftId && s.EmployeeId == me, ct) ?? throw new NotFoundException();
        var colleagues = await db.Employees.Include(e => e.JobRole)
            .Where(e => e.Id != me && e.Status == EmployeeStatus.Active && e.UserId != null && e.Locations.Any(l => l.LocationId == shift.LocationId))
            .OrderBy(e => e.FirstName).ThenBy(e => e.LastName).ToListAsync(ct);
        var result = new List<EligibleColleagueDto>();
        foreach (var c in colleagues)
        {
            var reason = await ConflictReasonAsync(c.Id, shift, ct);
            result.Add(new EligibleColleagueDto(c.Id, c.FullName, c.JobRole?.Name, reason is not null, reason));
        }
        return result;
    }

    public async Task<SwapDto> CreateAsync(CreateSwapRequest r, CancellationToken ct)
    {
        access.RequireFeature(PlanFeatures.ShiftSwaps);
        access.EnsureWritable();
        var me = access.RequireEmployee();
        var shift = await db.Shifts.SingleOrDefaultAsync(s => s.Id == r.ShiftId, ct) ?? throw new NotFoundException();
        if (shift.EmployeeId != me) throw new ForbiddenException("Sie können nur Ihre eigenen Schichten zum Tausch anbieten.");
        if (shift.Status != ShiftStatus.Published) throw new BusinessRuleException("swap_shift_not_published", "Nur veröffentlichte Schichten können getauscht werden.");
        if (shift.StartUtc <= clock.UtcNow) throw new BusinessRuleException("swap_shift_started", "Die Schicht hat bereits begonnen.");
        if (await db.ShiftSwaps.AnyAsync(s => s.ShiftId == shift.Id && (s.Status == SwapStatus.Pending || s.Status == SwapStatus.AwaitingApproval), ct))
            throw new ConflictException("swap_exists", "Für diese Schicht gibt es bereits eine offene Tauschanfrage.");

        var settings = await db.TenantSettings.SingleAsync(ct);
        if (r.TargetEmployeeId is null && !settings.AllowOpenSwapOffers)
            throw RequestValidationException.For("targetEmployeeId", "Bitte wählen Sie eine Kollegin oder einen Kollegen aus.");
        Employee? target = null;
        if (r.TargetEmployeeId is { } targetId)
        {
            if (targetId == me) throw RequestValidationException.For("targetEmployeeId", "Sie können die Schicht nicht mit sich selbst tauschen.");
            target = await db.Employees.SingleOrDefaultAsync(e => e.Id == targetId, ct) ?? throw RequestValidationException.For("targetEmployeeId", "Die Person existiert nicht.");
            var reason = await ConflictReasonAsync(targetId, shift, ct);
            if (reason is not null) throw new BusinessRuleException("swap_target_ineligible", reason);
        }

        var now = clock.UtcNow;
        var swap = new ShiftSwapRequest
        {
            TenantId = shift.TenantId, ShiftId = shift.Id, RequesterEmployeeId = me, TargetEmployeeId = r.TargetEmployeeId,
            OriginalEmployeeId = me, Message = r.Message.NullIfBlank(), CreatedAt = now, UpdatedAt = now
        };
        db.ShiftSwaps.Add(swap);
        var requester = await db.Employees.SingleAsync(e => e.Id == me, ct);
        var zone = await ZoneAsync(shift.LocationId, ct);
        var when = ShiftService.Describe(shift, zone);
        if (target?.UserId is { } targetUser)
            notifier.Notify(shift.TenantId, [targetUser], NotificationTypes.SwapRequested, "Anfrage zum Schichttausch",
                $"{requester.FullName} fragt, ob Sie die Schicht am {when} übernehmen können.", "/schichttausch", $"swap:{swap.Id}");
        else if (target is null)
        {
            var colleagues = await db.Employees.Where(e => e.Id != me && e.Status == EmployeeStatus.Active && e.UserId != null
                                                           && e.Locations.Any(l => l.LocationId == shift.LocationId))
                .Select(e => e.UserId!.Value).ToListAsync(ct);
            notifier.Notify(shift.TenantId, colleagues, NotificationTypes.SwapRequested, "Schicht zu vergeben",
                $"{requester.FullName} sucht eine Vertretung für die Schicht am {when}.", "/schichttausch", $"swap:{swap.Id}");
        }
        audit.Log("swap.created", "ShiftSwap", swap.Id, new { shift.Id, r.TargetEmployeeId });
        await db.SaveChangesAsync(ct);
        return await GetAsync(swap.Id, ct);
    }

    public async Task<SwapDto> AcceptAsync(Guid id, SwapActionRequest r, CancellationToken ct)
    {
        access.RequireFeature(PlanFeatures.ShiftSwaps);
        access.EnsureWritable();
        var me = access.RequireEmployee();
        var swap = await Include(db.ShiftSwaps).SingleOrDefaultAsync(s => s.Id == id, ct) ?? throw new NotFoundException();
        if (swap.TargetEmployeeId is not null && swap.TargetEmployeeId != me) throw new NotFoundException();
        if (swap.TargetEmployeeId is null && !access.Context.EmployeeLocationIds.Contains(swap.Shift!.LocationId)) throw new NotFoundException();
        db.ApplyClientVersion(swap, r.Version);
        if (swap.Status != SwapStatus.Pending)
            throw new BusinessRuleException("swap_invalid_transition", Messages.Get("swap_invalid_transition"));

        var reason = await ConflictReasonAsync(me, swap.Shift!, ct);
        if (reason is not null) throw new BusinessRuleException("swap_target_ineligible", reason);
        await EnsureShiftStillValidAsync(swap, ct);

        var settings = await db.TenantSettings.SingleAsync(ct);
        var now = clock.UtcNow;
        try { swap.Accept(me, settings.SwapRequiresManagerApproval, now); }
        catch (DomainException ex) { throw new BusinessRuleException(ex.Code, Messages.Get(ex.Code)); }
        swap.UpdatedAt = now;

        var acceptor = await db.Employees.SingleAsync(e => e.Id == me, ct);
        var zone = await ZoneAsync(swap.Shift!.LocationId, ct);
        var when = ShiftService.Describe(swap.Shift, zone);
        if (swap.Status == SwapStatus.Completed)
        {
            await ApplyAsync(swap, me, ct);
            NotifyParticipants(swap, "Schichttausch abgeschlossen", $"{acceptor.FullName} übernimmt die Schicht am {when}.");
        }
        else
        {
            var managers = await notifier.ManagersForLocationAsync(swap.TenantId, swap.Shift.LocationId, ManagerPermissions.ManageSwaps, ct);
            notifier.Notify(swap.TenantId, managers, NotificationTypes.ApprovalRequired, "Schichttausch zur Freigabe",
                $"{acceptor.FullName} möchte die Schicht von {swap.Requester!.FullName} am {when} übernehmen.", "/schichttausch", $"swap-accept:{swap.Id}");
            NotifyParticipants(swap, "Tausch angenommen", $"{acceptor.FullName} hat Ihre Tauschanfrage angenommen. Die Freigabe durch die Leitung steht noch aus.");
        }
        audit.Log("swap.accepted", "ShiftSwap", swap.Id, new { acceptedBy = me });
        await SaveAsync(ct);
        return await GetAsync(id, ct);
    }

    public async Task<SwapDto> DeclineAsync(Guid id, SwapActionRequest r, CancellationToken ct)
    {
        access.EnsureWritable();
        var me = access.RequireEmployee();
        var swap = await Include(db.ShiftSwaps).SingleOrDefaultAsync(s => s.Id == id && s.TargetEmployeeId == me, ct) ?? throw new NotFoundException();
        db.ApplyClientVersion(swap, r.Version);
        try { swap.Decline(me); }
        catch (DomainException ex) { throw new BusinessRuleException(ex.Code, Messages.Get(ex.Code)); }
        swap.DecisionReason = r.Reason.NullIfBlank();
        swap.UpdatedAt = clock.UtcNow;
        NotifyParticipants(swap, "Tauschanfrage abgelehnt", $"{swap.Target!.FullName} kann die Schicht leider nicht übernehmen.");
        audit.Log("swap.declined", "ShiftSwap", swap.Id);
        await SaveAsync(ct);
        return await GetAsync(id, ct);
    }

    public async Task<SwapDto> ApproveAsync(Guid id, SwapActionRequest r, CancellationToken ct)
    {
        access.EnsureWritable();
        var swap = await Include(db.ShiftSwaps).SingleOrDefaultAsync(s => s.Id == id, ct) ?? throw new NotFoundException();
        access.Require(ManagerPermissions.ManageSwaps, swap.Shift!.LocationId);
        db.ApplyClientVersion(swap, r.Version);
        if (swap.AcceptedByEmployeeId is not { } newEmployee || swap.Status != SwapStatus.AwaitingApproval)
            throw new BusinessRuleException("swap_invalid_transition", Messages.Get("swap_invalid_transition"));

        // Re-validate everything immediately before finalising.
        await EnsureShiftStillValidAsync(swap, ct);
        var reason = await ConflictReasonAsync(newEmployee, swap.Shift, ct);
        if (reason is not null) throw new BusinessRuleException("swap_target_ineligible", reason);

        try { swap.Approve(access.UserId, clock.UtcNow); }
        catch (DomainException ex) { throw new BusinessRuleException(ex.Code, Messages.Get(ex.Code)); }
        swap.UpdatedAt = clock.UtcNow;
        await ApplyAsync(swap, newEmployee, ct);
        var zone = await ZoneAsync(swap.Shift.LocationId, ct);
        NotifyParticipants(swap, "Schichttausch genehmigt",
            $"Der Tausch der Schicht am {ShiftService.Describe(swap.Shift, zone)} wurde genehmigt. {swap.AcceptedBy!.FullName} übernimmt die Schicht.");
        audit.Log("swap.approved", "ShiftSwap", swap.Id, new { from = swap.OriginalEmployeeId, to = newEmployee });
        await SaveAsync(ct);
        return await GetAsync(id, ct);
    }

    public async Task<SwapDto> RejectAsync(Guid id, SwapActionRequest r, CancellationToken ct)
    {
        access.EnsureWritable();
        var swap = await Include(db.ShiftSwaps).SingleOrDefaultAsync(s => s.Id == id, ct) ?? throw new NotFoundException();
        access.Require(ManagerPermissions.ManageSwaps, swap.Shift!.LocationId);
        db.ApplyClientVersion(swap, r.Version);
        try { swap.Reject(access.UserId, r.Reason); }
        catch (DomainException ex) { throw new BusinessRuleException(ex.Code, Messages.Get(ex.Code)); }
        swap.UpdatedAt = clock.UtcNow;
        NotifyParticipants(swap, "Schichttausch abgelehnt", $"Die Leitung hat den Schichttausch abgelehnt.{(swap.DecisionReason is null ? "" : " Grund: " + swap.DecisionReason)}");
        audit.Log("swap.rejected", "ShiftSwap", swap.Id);
        await SaveAsync(ct);
        return await GetAsync(id, ct);
    }

    public async Task<SwapDto> CancelAsync(Guid id, SwapActionRequest r, CancellationToken ct)
    {
        access.EnsureWritable();
        var me = access.RequireEmployee();
        var swap = await Include(db.ShiftSwaps).SingleOrDefaultAsync(s => s.Id == id && s.RequesterEmployeeId == me, ct) ?? throw new NotFoundException();
        db.ApplyClientVersion(swap, r.Version);
        try { swap.Cancel(me); }
        catch (DomainException ex) { throw new BusinessRuleException(ex.Code, Messages.Get(ex.Code)); }
        swap.UpdatedAt = clock.UtcNow;
        audit.Log("swap.cancelled", "ShiftSwap", swap.Id);
        await SaveAsync(ct);
        return await GetAsync(id, ct);
    }

    public async Task<SwapDto> GetAsync(Guid id, CancellationToken ct)
    {
        var swap = await Include(db.ShiftSwaps).AsSplitQuery().SingleOrDefaultAsync(s => s.Id == id, ct) ?? throw new NotFoundException();
        var me = access.Context.EmployeeId;
        var participant = me is not null && (swap.RequesterEmployeeId == me || swap.TargetEmployeeId == me || swap.AcceptedByEmployeeId == me
                                              || (swap.TargetEmployeeId is null && access.Context.EmployeeLocationIds.Contains(swap.Shift!.LocationId)));
        var manager = access.Has(ManagerPermissions.ManageSwaps) && access.Context.ManagedLocationIds.Contains(swap.Shift!.LocationId);
        if (!participant && !manager) throw new NotFoundException();
        return await ToDtoAsync(swap, await db.TenantSettings.SingleAsync(ct), ct);
    }

    /// <summary>Transfers the shift. Concurrency tokens on shift and swap guarantee a swap is applied at most once.</summary>
    private async Task ApplyAsync(ShiftSwapRequest swap, Guid newEmployeeId, CancellationToken ct)
    {
        var shift = swap.Shift!;
        shift.EmployeeId = newEmployeeId;
        shift.UpdatedAt = clock.UtcNow;
        // Force a rowversion check on the shift even though only the assignment changes.
        db.Entry(shift).Property(nameof(Shift.EmployeeId)).IsModified = true;
        foreach (var other in await db.ShiftSwaps.Where(s => s.ShiftId == shift.Id && s.Id != swap.Id
                                                             && (s.Status == SwapStatus.Pending || s.Status == SwapStatus.AwaitingApproval)).ToListAsync(ct))
            other.Invalidate();
    }

    private async Task EnsureShiftStillValidAsync(ShiftSwapRequest swap, CancellationToken ct)
    {
        var shift = swap.Shift!;
        var stillValid = shift.Status == ShiftStatus.Published && shift.EmployeeId == swap.OriginalEmployeeId && shift.StartUtc > clock.UtcNow;
        if (stillValid) return;
        swap.Invalidate();
        swap.UpdatedAt = clock.UtcNow;
        await SaveAsync(ct);
        throw new ConflictException("swap_obsolete", "Die Schicht wurde inzwischen geändert, abgesagt oder hat bereits begonnen. Die Tauschanfrage ist damit hinfällig.");
    }

    /// <summary>Returns a German reason why the employee cannot take the shift, or null if eligible.</summary>
    private async Task<string?> ConflictReasonAsync(Guid employeeId, Shift shift, CancellationToken ct)
    {
        var e = await db.Employees.Include(x => x.Locations).SingleOrDefaultAsync(x => x.Id == employeeId, ct);
        if (e is null || e.Status != EmployeeStatus.Active) return "Die Person ist nicht aktiv.";
        if (e.Locations.All(l => l.LocationId != shift.LocationId)) return $"{e.FullName} ist diesem Standort nicht zugeordnet.";
        if (await db.Shifts.AnyAsync(s => s.EmployeeId == employeeId && s.Id != shift.Id && s.Status != ShiftStatus.Cancelled
                                          && s.StartUtc < shift.EndUtc && shift.StartUtc < s.EndUtc, ct))
            return $"{e.FullName} hat zu dieser Zeit bereits eine Schicht.";
        if (await db.LeaveRequests.AnyAsync(l => l.EmployeeId == employeeId && l.Status == LeaveStatus.Approved
                                                 && l.StartDate <= shift.LocalDate && l.EndDate >= shift.LocalDate, ct))
            return $"{e.FullName} ist an diesem Tag abwesend.";
        return null;
    }

    private void NotifyParticipants(ShiftSwapRequest swap, string title, string body)
    {
        var users = new[] { swap.Requester?.UserId, swap.Target?.UserId, swap.AcceptedBy?.UserId }.Where(u => u is not null).Select(u => u!.Value);
        notifier.Notify(swap.TenantId, users, NotificationTypes.SwapUpdated, title, body, "/schichttausch");
    }

    private async Task SaveAsync(CancellationToken ct)
    {
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException)
        {
            throw new ConflictException("concurrency_conflict", "Die Tauschanfrage oder die Schicht wurde zwischenzeitlich geändert. Bitte laden Sie die Ansicht neu.");
        }
    }

    private async Task<TimeZoneInfo> ZoneAsync(Guid locationId, CancellationToken ct) =>
        Domain.Scheduling.ZonedTime.Find(await db.Locations.Where(l => l.Id == locationId).Select(l => l.TimeZoneId).SingleAsync(ct));

    private static IQueryable<ShiftSwapRequest> Include(IQueryable<ShiftSwapRequest> q) => q
        .Include(s => s.Shift).ThenInclude(s => s!.JobRole)
        .Include(s => s.Shift).ThenInclude(s => s!.Location)
        .Include(s => s.Shift).ThenInclude(s => s!.Employee)
        .Include(s => s.Requester).Include(s => s.Target).Include(s => s.AcceptedBy);

    private async Task<SwapDto> ToDtoAsync(ShiftSwapRequest s, TenantSettings settings, CancellationToken ct)
    {
        var me = access.Context.EmployeeId;
        var isManager = access.Has(ManagerPermissions.ManageSwaps) && access.Context.ManagedLocationIds.Contains(s.Shift!.LocationId);
        var canAccept = s.Status == SwapStatus.Pending && me is not null && me != s.RequesterEmployeeId && (s.TargetEmployeeId is null || s.TargetEmployeeId == me);
        var shift = await shifts.MapAsync(s.Shift!, ct);
        return new SwapDto(s.Id, shift, s.RequesterEmployeeId, s.Requester?.FullName ?? "", s.TargetEmployeeId, s.Target?.FullName,
            s.AcceptedByEmployeeId, s.AcceptedBy?.FullName, s.Status, s.Message, s.DecisionReason, s.CreatedAt, s.CompletedAt, s.RowVersion.ToVersion(),
            CanAccept: canAccept,
            CanDecline: s.Status == SwapStatus.Pending && me is not null && s.TargetEmployeeId == me,
            CanApprove: isManager && s.Status == SwapStatus.AwaitingApproval,
            CanReject: isManager && s.IsOpen,
            CanCancel: s.IsOpen && me == s.RequesterEmployeeId);
    }
}
