using GastroTeam.Application.Common;
using GastroTeam.Application.Features.Dashboard;
using GastroTeam.Application.Features.Notifications;
using GastroTeam.Application.Features.Reports;
using GastroTeam.Application.Features.Scheduling;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace GastroTeam.Api.Controllers;

[ApiController, Authorize]
[Route("api/v1/shifts")]
public sealed class ShiftsController(ShiftService shifts) : ControllerBase
{
    [HttpGet]
    public Task<IReadOnlyList<ShiftDto>> List([FromQuery] ShiftQuery query, CancellationToken ct) => shifts.ListAsync(query, ct);

    [HttpGet("mine")]
    public Task<IReadOnlyList<ShiftDto>> Mine([FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken ct) => shifts.MyShiftsAsync(from, to, ct);

    [HttpGet("{id:guid}")]
    public Task<ShiftDto> Get(Guid id, CancellationToken ct) => shifts.GetAsync(id, ct);

    [HttpPost]
    public async Task<ActionResult<ShiftSaveResult>> Create(SaveShiftRequest req, CancellationToken ct) => StatusCode(201, await shifts.CreateAsync(req, ct));

    [HttpPut("{id:guid}")]
    public Task<ShiftSaveResult> Update(Guid id, SaveShiftRequest req, CancellationToken ct) => shifts.UpdateAsync(id, req, ct);

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, [FromQuery] string version, CancellationToken ct)
    {
        await shifts.DeleteAsync(id, version, ct);
        return NoContent();
    }

    [HttpPost("{id:guid}/assign")]
    public Task<ShiftSaveResult> Assign(Guid id, AssignShiftRequest req, CancellationToken ct) => shifts.AssignAsync(id, req, ct);

    [HttpPost("{id:guid}/cancel")]
    public Task<ShiftDto> Cancel(Guid id, VersionRequest req, CancellationToken ct) => shifts.CancelAsync(id, req.Version, ct);

    [HttpPost("{id:guid}/duplicate")]
    public async Task<ActionResult<ShiftSaveResult>> Duplicate(Guid id, DuplicateShiftRequest req, CancellationToken ct) =>
        StatusCode(201, await shifts.DuplicateAsync(id, req, ct));

    [HttpPost("{id:guid}/publish")]
    public Task<ShiftSaveResult> Publish(Guid id, CancellationToken ct) => shifts.PublishOneAsync(id, ct);
}

[ApiController, Authorize]
[Route("api/v1/schedules")]
public sealed class SchedulesController(ScheduleService schedules, ShiftService shifts) : ControllerBase
{
    [HttpGet("week")]
    public Task<WeekViewDto> Week([FromQuery] Guid locationId, [FromQuery] DateOnly date, CancellationToken ct) => schedules.GetWeekAsync(locationId, date, ct);

    [HttpGet("team")]
    public Task<IReadOnlyList<ShiftDto>> Team([FromQuery] Guid locationId, [FromQuery] DateOnly weekStart, CancellationToken ct) =>
        shifts.TeamScheduleAsync(locationId, Domain.Scheduling.ZonedTime.WeekStart(weekStart), ct);

    [HttpGet("validation")]
    public Task<ValidationReportDto> Validate([FromQuery] Guid locationId, [FromQuery] DateOnly date, CancellationToken ct) => schedules.ValidateWeekAsync(locationId, date, ct);

    [HttpPost("publish")]
    public Task<PublishResult> Publish(PublishWeekRequest req, CancellationToken ct) => schedules.PublishWeekAsync(req, ct);

    [HttpPost("unpublish")]
    public async Task<ActionResult<object>> Unpublish(UnpublishWeekRequest req, CancellationToken ct) =>
        Ok(new { revertedShifts = await schedules.UnpublishWeekAsync(req, ct) });

    [HttpPost("copy-week")]
    public Task<CopyResult> CopyWeek(CopyWeekRequest req, CancellationToken ct) => schedules.CopyWeekAsync(req, ct);

    [HttpPost("copy-day")]
    public Task<CopyResult> CopyDay(CopyDayRequest req, CancellationToken ct) => schedules.CopyDayAsync(req, ct);
}

[ApiController, Authorize]
[Route("api/v1/dashboard")]
public sealed class DashboardController(DashboardService dashboard) : ControllerBase
{
    [HttpGet("summary")]
    public Task<DashboardSummaryDto> Summary([FromQuery] Guid? locationId, CancellationToken ct) => dashboard.SummaryAsync(locationId, ct);

    [HttpGet("today")]
    public Task<IReadOnlyList<ShiftDto>> Today([FromQuery] Guid? locationId, CancellationToken ct) => dashboard.TodayAsync(locationId, ct);

    [HttpGet("action-items")]
    public Task<IReadOnlyList<ActionItemDto>> ActionItems([FromQuery] Guid? locationId, CancellationToken ct) => dashboard.ActionItemsAsync(locationId, ct);

    [HttpGet("employee")]
    public Task<EmployeeOverviewDto> Employee(CancellationToken ct) => dashboard.EmployeeOverviewAsync(ct);
}

[ApiController, Authorize]
[Route("api/v1/notifications")]
public sealed class NotificationsController(NotificationQueryService notifications) : ControllerBase
{
    [HttpGet]
    public Task<PagedResult<NotificationDto>> List([FromQuery] bool unreadOnly = false, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default) =>
        notifications.ListAsync(unreadOnly, page, pageSize, ct);

    [HttpGet("unread-count")]
    public async Task<object> UnreadCount(CancellationToken ct) => new { count = await notifications.UnreadCountAsync(ct) };

    [HttpPost("{id:guid}/read")]
    public async Task<IActionResult> Read(Guid id, CancellationToken ct)
    {
        await notifications.MarkReadAsync(id, ct);
        return NoContent();
    }

    [HttpPost("read-all")]
    public async Task<object> ReadAll(CancellationToken ct) => new { updated = await notifications.MarkAllReadAsync(ct) };
}

[ApiController, Authorize]
[Route("api/v1/reports")]
public sealed class ReportsController(ReportService reports) : ControllerBase
{

    [HttpGet("scheduled-hours")]
    public async Task<IActionResult> ScheduledHours([FromQuery] ReportQuery q, [FromQuery] string? format, CancellationToken ct)
    {
        var rows = await reports.ScheduledHoursAsync(q, ct);
        return format == "csv"
            ? File(ReportService.ToCsv("geplante-stunden", q, rows,
                ("Mitarbeiter/in", r => r.EmployeeName), ("Rolle", r => r.JobRole), ("Vertragsstunden/Woche", r => r.ContractHoursPerWeek),
                ("Schichten", r => r.Shifts), ("Geplante Stunden (gesamt)", r => r.PlannedHours), ("Davon veröffentlicht", r => r.PublishedHours)))
            : Ok(rows);
    }

    [HttpGet("location-hours")]
    public async Task<IActionResult> LocationHours([FromQuery] ReportQuery q, [FromQuery] string? format, CancellationToken ct)
    {
        var rows = await reports.LocationHoursAsync(q, ct);
        return format == "csv"
            ? File(ReportService.ToCsv("standorte", q, rows, ("Standort", r => r.LocationName), ("Schichten", r => r.Shifts),
                ("Unbesetzt", r => r.UnassignedShifts), ("Geplante Stunden", r => r.PlannedHours)))
            : Ok(rows);
    }

    [HttpGet("staffing")]
    public async Task<IActionResult> Staffing([FromQuery] ReportQuery q, [FromQuery] string? format, CancellationToken ct)
    {
        var rows = await reports.StaffingAsync(q, ct);
        return format == "csv"
            ? File(ReportService.ToCsv("personalbesetzung", q, rows, ("Datum", r => r.Date), ("Standort", r => r.LocationName), ("Rolle", r => r.JobRole),
                ("Schichten", r => r.Shifts), ("Besetzt", r => r.Assigned), ("Unbesetzt", r => r.Unassigned), ("Geplante Stunden", r => r.PlannedHours)))
            : Ok(rows);
    }

    [HttpGet("unassigned-shifts")]
    public async Task<IActionResult> Unassigned([FromQuery] ReportQuery q, [FromQuery] string? format, CancellationToken ct)
    {
        var rows = await reports.UnassignedAsync(q, ct);
        return format == "csv"
            ? File(ReportService.ToCsv("unbesetzte-schichten", q, rows, ("Datum", r => r.Date), ("Standort", r => r.LocationName), ("Rolle", r => r.JobRole),
                ("Beginn", r => r.Start), ("Ende", r => r.End), ("Status", r => r.Status)))
            : Ok(rows);
    }

    [HttpGet("leave")]
    public async Task<IActionResult> Leave([FromQuery] ReportQuery q, [FromQuery] string? format, CancellationToken ct)
    {
        var rows = await reports.LeaveAsync(q, ct);
        return format == "csv"
            ? File(ReportService.ToCsv("abwesenheiten", q, rows, ("Mitarbeiter/in", r => r.EmployeeName), ("Art", r => r.Type), ("Von", r => r.StartDate),
                ("Bis", r => r.EndDate), ("Tage", r => r.Days), ("Status", r => r.Status)))
            : Ok(rows);
    }

    [HttpGet("employee-status")]
    public async Task<IActionResult> EmployeeStatus([FromQuery] ReportQuery q, [FromQuery] string? format, CancellationToken ct)
    {
        var rows = await reports.EmployeeStatusAsync(q, ct);
        return format == "csv" ? File(ReportService.ToCsv("mitarbeiterstatus", q, rows, ("Status", r => r.Status), ("Anzahl", r => r.Count))) : Ok(rows);
    }

    [HttpGet("shift-changes")]
    public async Task<IActionResult> ShiftChanges([FromQuery] ReportQuery q, [FromQuery] string? format, CancellationToken ct)
    {
        var rows = await reports.ShiftChangesAsync(q, ct);
        return format == "csv"
            ? File(ReportService.ToCsv("schichtaenderungen", q, rows, ("Zeitpunkt", r => r.At), ("Aktion", r => r.Action), ("Durch", r => r.UserName), ("Schicht-ID", r => r.ShiftId)))
            : Ok(rows);
    }

    private FileContentResult File(Csv csv) => File(csv.Content, "text/csv; charset=utf-8", csv.FileName);
}
