using GastroTeam.Domain.Common;

namespace GastroTeam.Domain.Entities;

/// <summary>Employment record of a person within one tenant. Optionally linked to a login.</summary>
public class Employee : Entity, ITenantOwned, IVersioned
{
    public Guid TenantId { get; set; }
    public Guid? UserId { get; set; }
    public string FirstName { get; set; } = "";
    public string LastName { get; set; } = "";
    public string? Email { get; set; }
    public string? NormalizedEmail { get; set; }
    public string? Phone { get; set; }
    public string? ProfileImageUrl { get; set; }
    public Guid? JobRoleId { get; set; }
    public EmployeeStatus Status { get; set; } = EmployeeStatus.Active;
    public decimal? ContractHoursPerWeek { get; set; }
    public DateOnly? EmploymentStartDate { get; set; }
    public DateOnly? EmploymentEndDate { get; set; }
    public string PreferredLanguage { get; set; } = "de-DE";
    public string? Notes { get; set; }
    public DateTime? AnonymizedAt { get; set; }
    public byte[] RowVersion { get; set; } = [];

    public JobRole? JobRole { get; set; }
    public List<EmployeeLocationAssignment> Locations { get; set; } = [];

    public string FullName => $"{FirstName} {LastName}".Trim();

    /// <summary>Employees counted against the plan's active-employee limit.</summary>
    public bool CountsTowardsLimit => Status is EmployeeStatus.Active or EmployeeStatus.Invited;

    public bool CanBeScheduled => Status is EmployeeStatus.Active or EmployeeStatus.Invited;

    public void Deactivate(DateOnly? endDate)
    {
        if (Status == EmployeeStatus.Archived) throw new DomainException("employee_archived");
        Status = EmployeeStatus.Inactive;
        EmploymentEndDate ??= endDate;
    }

    public void Reactivate()
    {
        if (Status == EmployeeStatus.Archived) throw new DomainException("employee_archived");
        Status = UserId is null ? EmployeeStatus.Invited : EmployeeStatus.Active;
        EmploymentEndDate = null;
    }

    /// <summary>GDPR anonymisation: removes personal data while preserving shift history.</summary>
    public void Anonymize(DateTime now)
    {
        if (Status is not (EmployeeStatus.Inactive or EmployeeStatus.Archived))
            throw new DomainException("employee_must_be_inactive");
        FirstName = "Ehemalige Person";
        LastName = Id.ToString("N")[..6];
        Email = null;
        NormalizedEmail = null;
        Phone = null;
        ProfileImageUrl = null;
        Notes = null;
        UserId = null;
        Status = EmployeeStatus.Archived;
        AnonymizedAt = now;
    }
}

public class EmployeeLocationAssignment : ITenantOwned
{
    public Guid TenantId { get; set; }
    public Guid EmployeeId { get; set; }
    public Guid LocationId { get; set; }
    public RestaurantLocation? Location { get; set; }
}

/// <summary>
/// Recurring weekly availability. Rows are never updated in place; a change closes the current
/// rows (ValidTo) and inserts new ones so historical availability stays auditable.
/// </summary>
public class EmployeeAvailability : ITenantOwned
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid EmployeeId { get; set; }
    public DayOfWeek DayOfWeek { get; set; }
    public TimeOnly StartTime { get; set; }
    /// <summary>End at or before start means the window runs past midnight.</summary>
    public TimeOnly EndTime { get; set; }
    public AvailabilityKind Kind { get; set; }
    public string? Note { get; set; }
    public DateOnly ValidFrom { get; set; }
    public DateOnly? ValidTo { get; set; }
    public DateTime CreatedAt { get; set; }

    public bool IsValidOn(DateOnly date) => ValidFrom <= date && (ValidTo is null || ValidTo >= date);
}

/// <summary>Specific date on which an employee is not available (whole day or a time window).</summary>
public class AvailabilityException : ITenantOwned
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid EmployeeId { get; set; }
    public DateOnly Date { get; set; }
    public TimeOnly? StartTime { get; set; }
    public TimeOnly? EndTime { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; }
}
