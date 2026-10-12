using GastroTeam.Domain.Common;

namespace GastroTeam.Domain.Entities;

public class Shift : Entity, ITenantOwned, IVersioned
{
    public Guid TenantId { get; set; }
    public Guid LocationId { get; set; }
    public Guid? EmployeeId { get; set; }
    public Guid JobRoleId { get; set; }
    public DateTime StartUtc { get; set; }
    public DateTime EndUtc { get; set; }
    /// <summary>Local calendar date (location time zone) on which the shift starts. Used for week grouping.</summary>
    public DateOnly LocalDate { get; set; }
    public int BreakMinutes { get; set; }
    public string? Notes { get; set; }
    public ShiftStatus Status { get; set; } = ShiftStatus.Draft;
    public Guid CreatedByUserId { get; set; }
    public DateTime? PublishedAt { get; set; }
    public DateTime? CancelledAt { get; set; }
    public byte[] RowVersion { get; set; } = [];

    public RestaurantLocation? Location { get; set; }
    public Employee? Employee { get; set; }
    public JobRole? JobRole { get; set; }

    public double PaidHours => Math.Max(0, (EndUtc - StartUtc).TotalMinutes - BreakMinutes) / 60d;

    public void Publish(DateTime now)
    {
        if (Status == ShiftStatus.Cancelled) throw new DomainException("shift_cancelled");
        Status = ShiftStatus.Published;
        PublishedAt ??= now;
    }

    public void Unpublish()
    {
        if (Status == ShiftStatus.Cancelled) throw new DomainException("shift_cancelled");
        Status = ShiftStatus.Draft;
        PublishedAt = null;
    }

    public void Cancel(DateTime now)
    {
        if (Status == ShiftStatus.Cancelled) throw new DomainException("shift_cancelled");
        Status = ShiftStatus.Cancelled;
        CancelledAt = now;
    }
}

/// <summary>History record of every publish/unpublish of a location week.</summary>
public class ShiftPublication : ITenantOwned
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid LocationId { get; set; }
    public DateOnly WeekStart { get; set; }
    public PublicationAction Action { get; set; }
    public DateTime CreatedAt { get; set; }
    public Guid UserId { get; set; }
    public int ShiftCount { get; set; }
    public int WarningCount { get; set; }
}

public class LeaveRequest : Entity, ITenantOwned, IVersioned
{
    public Guid TenantId { get; set; }
    public Guid EmployeeId { get; set; }
    public LeaveType Type { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    /// <summary>Free text from the employee. For sick leave only managers can read it; no diagnoses should be entered.</summary>
    public string? Note { get; set; }
    public LeaveStatus Status { get; set; } = LeaveStatus.Pending;
    public string? DecisionReason { get; set; }
    public Guid? DecidedByUserId { get; set; }
    public DateTime? DecidedAt { get; set; }
    public byte[] RowVersion { get; set; } = [];

    public Employee? Employee { get; set; }

    public int Days => EndDate.DayNumber - StartDate.DayNumber + 1;

    public bool Overlaps(DateOnly start, DateOnly end) => StartDate <= end && EndDate >= start;

    public void Approve(Guid userId, DateTime now)
    {
        if (Status != LeaveStatus.Pending) throw new DomainException("leave_invalid_transition");
        Status = LeaveStatus.Approved;
        DecidedByUserId = userId;
        DecidedAt = now;
    }

    public void Reject(Guid userId, string reason, DateTime now)
    {
        if (Status != LeaveStatus.Pending) throw new DomainException("leave_invalid_transition");
        if (string.IsNullOrWhiteSpace(reason)) throw new DomainException("leave_reason_required");
        Status = LeaveStatus.Rejected;
        DecisionReason = reason.Trim();
        DecidedByUserId = userId;
        DecidedAt = now;
    }

    /// <summary>Employees may cancel pending requests; managers may also withdraw approved future leave.</summary>
    public void Cancel(Guid userId, bool byManager, DateOnly today, DateTime now)
    {
        var allowed = Status == LeaveStatus.Pending || (byManager && Status == LeaveStatus.Approved && EndDate >= today);
        if (!allowed) throw new DomainException("leave_invalid_transition");
        Status = LeaveStatus.Cancelled;
        DecidedByUserId = userId;
        DecidedAt = now;
    }
}

public class ShiftSwapRequest : Entity, ITenantOwned, IVersioned
{
    public Guid TenantId { get; set; }
    public Guid ShiftId { get; set; }
    public Guid RequesterEmployeeId { get; set; }
    /// <summary>Specific colleague asked to take the shift; null for an open offer to all eligible colleagues.</summary>
    public Guid? TargetEmployeeId { get; set; }
    public Guid? AcceptedByEmployeeId { get; set; }
    public SwapStatus Status { get; set; } = SwapStatus.Pending;
    public string? Message { get; set; }
    public string? DecisionReason { get; set; }
    public Guid OriginalEmployeeId { get; set; }
    public Guid? FinalEmployeeId { get; set; }
    public Guid? DecidedByUserId { get; set; }
    public DateTime? CompletedAt { get; set; }
    public byte[] RowVersion { get; set; } = [];

    public Shift? Shift { get; set; }
    public Employee? Requester { get; set; }
    public Employee? Target { get; set; }
    public Employee? AcceptedBy { get; set; }

    public bool IsOpen => Status is SwapStatus.Pending or SwapStatus.AwaitingApproval;

    public void Accept(Guid employeeId, bool requiresApproval, DateTime now)
    {
        if (Status != SwapStatus.Pending) throw new DomainException("swap_invalid_transition");
        if (employeeId == RequesterEmployeeId) throw new DomainException("swap_self");
        if (TargetEmployeeId is not null && TargetEmployeeId != employeeId) throw new DomainException("swap_not_target");
        AcceptedByEmployeeId = employeeId;
        Status = requiresApproval ? SwapStatus.AwaitingApproval : SwapStatus.Completed;
        if (Status == SwapStatus.Completed) Complete(employeeId, now);
    }

    public void Decline(Guid employeeId)
    {
        if (Status != SwapStatus.Pending) throw new DomainException("swap_invalid_transition");
        if (TargetEmployeeId != employeeId) throw new DomainException("swap_not_target");
        Status = SwapStatus.Declined;
    }

    public void Approve(Guid userId, DateTime now)
    {
        if (Status != SwapStatus.AwaitingApproval || AcceptedByEmployeeId is null)
            throw new DomainException("swap_invalid_transition");
        DecidedByUserId = userId;
        Complete(AcceptedByEmployeeId.Value, now);
    }

    public void Reject(Guid userId, string? reason)
    {
        if (!IsOpen) throw new DomainException("swap_invalid_transition");
        Status = SwapStatus.Rejected;
        DecidedByUserId = userId;
        DecisionReason = reason?.Trim();
    }

    public void Cancel(Guid requesterEmployeeId)
    {
        if (!IsOpen) throw new DomainException("swap_invalid_transition");
        if (requesterEmployeeId != RequesterEmployeeId) throw new DomainException("swap_not_requester");
        Status = SwapStatus.Cancelled;
    }

    public void Invalidate()
    {
        if (IsOpen) Status = SwapStatus.Invalidated;
    }

    private void Complete(Guid newEmployeeId, DateTime now)
    {
        Status = SwapStatus.Completed;
        FinalEmployeeId = newEmployeeId;
        CompletedAt = now;
    }
}
