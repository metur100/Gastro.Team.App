using GastroTeam.Domain.Entities;
using FluentValidation;

namespace GastroTeam.Application.Features.Scheduling;

public sealed record ShiftDto(
    Guid Id, Guid LocationId, string? LocationName, Guid? EmployeeId, string? EmployeeName, Guid JobRoleId, string JobRoleName, string JobRoleColor,
    DateOnly Date, TimeOnly StartTime, TimeOnly EndTime, bool EndsNextDay, DateTime StartUtc, DateTime EndUtc,
    int BreakMinutes, double PaidHours, string? Notes, ShiftStatus Status, DateTime? PublishedAt, string Version);

public sealed record IssueDto(string Severity, string Code, string Message, Guid? ShiftId, Guid? EmployeeId, DateOnly? Date);

public sealed record ShiftSaveResult(ShiftDto Shift, IReadOnlyList<IssueDto> Issues);

public sealed record SaveShiftRequest(
    Guid LocationId, Guid JobRoleId, Guid? EmployeeId, DateOnly Date, TimeOnly StartTime, TimeOnly EndTime,
    int BreakMinutes, string? Notes, string? Version = null);

public sealed record AssignShiftRequest(Guid? EmployeeId, string Version);
public sealed record VersionRequest(string Version);
public sealed record DuplicateShiftRequest(DateOnly? Date, bool KeepEmployee = false);

public sealed record ShiftQuery(Guid? LocationId, DateOnly From, DateOnly To, Guid? EmployeeId = null, Guid? JobRoleId = null,
    ShiftStatus? Status = null, bool UnassignedOnly = false);

public sealed record PublishWeekRequest(Guid LocationId, DateOnly WeekStart, bool AcknowledgeWarnings);
public sealed record UnpublishWeekRequest(Guid LocationId, DateOnly WeekStart);
public sealed record PublishResult(int PublishedShifts, int NotifiedEmployees, IReadOnlyList<IssueDto> Issues);
public sealed record CopyWeekRequest(Guid LocationId, DateOnly SourceWeekStart, DateOnly TargetWeekStart, bool IncludeAssignments);
public sealed record CopyDayRequest(Guid LocationId, DateOnly SourceDate, DateOnly TargetDate, bool IncludeAssignments);
public sealed record CopyResult(int CreatedShifts, int SkippedAssignments);

public sealed record DayInfoDto(DateOnly Date, bool IsClosed, TimeOnly? OpensAt, TimeOnly? ClosesAt);
public sealed record AvailabilityHintDto(DayOfWeek DayOfWeek, TimeOnly StartTime, TimeOnly EndTime, AvailabilityKind Kind);
public sealed record AbsenceHintDto(DateOnly Date, string Kind, string Label);

public sealed record WeekEmployeeDto(
    Guid Id, string FullName, Guid? JobRoleId, string? JobRoleName, decimal? ContractHoursPerWeek, double PlannedHours,
    EmployeeStatus Status, IReadOnlyList<AvailabilityHintDto> Availability, IReadOnlyList<AbsenceHintDto> Absences);

public sealed record PublicationStateDto(string State, int DraftShifts, int PublishedShifts, DateTime? LastPublishedAt);

public sealed record WeekViewDto(
    Guid LocationId, string LocationName, string TimeZoneId, DateOnly WeekStart, IReadOnlyList<DayInfoDto> Days,
    IReadOnlyList<ShiftDto> Shifts, IReadOnlyList<WeekEmployeeDto> Employees, IReadOnlyList<IssueDto> Issues,
    PublicationStateDto Publication, double TotalPlannedHours, int UnassignedShifts);

public sealed record ValidationReportDto(IReadOnlyList<IssueDto> Issues, int Errors, int Warnings, int Infos);

public sealed class SaveShiftRequestValidator : AbstractValidator<SaveShiftRequest>
{
    public SaveShiftRequestValidator()
    {
        RuleFor(x => x.LocationId).NotEmpty().WithMessage("Bitte wählen Sie einen Standort.");
        RuleFor(x => x.JobRoleId).NotEmpty().WithMessage("Bitte wählen Sie eine Rolle bzw. Station.");
        RuleFor(x => x.EndTime).NotEqual(x => x.StartTime).WithMessage("Beginn und Ende dürfen nicht identisch sein.");
        RuleFor(x => x.BreakMinutes).InclusiveBetween(0, 240).WithMessage("Die Pause muss zwischen 0 und 240 Minuten liegen.");
        RuleFor(x => x.Notes).MaximumLength(500);
        RuleFor(x => x.Date).Must(d => d.Year is >= 2020 and <= 2100).WithMessage("Das Datum ist ungültig.");
    }
}

public sealed class CopyWeekRequestValidator : AbstractValidator<CopyWeekRequest>
{
    public CopyWeekRequestValidator()
    {
        RuleFor(x => x.SourceWeekStart).Must(d => d.DayOfWeek == DayOfWeek.Monday).WithMessage("Die Woche muss an einem Montag beginnen.");
        RuleFor(x => x.TargetWeekStart).Must(d => d.DayOfWeek == DayOfWeek.Monday).WithMessage("Die Woche muss an einem Montag beginnen.")
            .NotEqual(x => x.SourceWeekStart).WithMessage("Quell- und Zielwoche müssen sich unterscheiden.");
    }
}

public sealed class CopyDayRequestValidator : AbstractValidator<CopyDayRequest>
{
    public CopyDayRequestValidator()
    {
        RuleFor(x => x.TargetDate).NotEqual(x => x.SourceDate).WithMessage("Quell- und Zieltag müssen sich unterscheiden.");
    }
}
