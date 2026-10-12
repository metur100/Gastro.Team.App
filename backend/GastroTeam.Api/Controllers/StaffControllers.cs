using GastroTeam.Application.Common;
using GastroTeam.Application.Features.Availability;
using GastroTeam.Application.Features.Employees;
using GastroTeam.Application.Features.Invitations;
using GastroTeam.Application.Features.Leave;
using GastroTeam.Application.Features.Swaps;
using GastroTeam.Domain.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace GastroTeam.Api.Controllers;

[ApiController, Authorize]
[Route("api/v1/employees")]
public sealed class EmployeesController(EmployeeService employees, InvitationService invitations) : ControllerBase
{
    [HttpGet]
    public Task<PagedResult<EmployeeDto>> List([FromQuery] EmployeeQuery query, CancellationToken ct) => employees.ListAsync(query, ct);

    [HttpGet("colleagues")]
    public Task<IReadOnlyList<ColleagueDto>> Colleagues([FromQuery] Guid? locationId, CancellationToken ct) => employees.ColleaguesAsync(locationId, ct);

    [HttpGet("{id:guid}")]
    public Task<EmployeeDto> Get(Guid id, CancellationToken ct) => employees.GetAsync(id, ct);

    [HttpPost]
    public async Task<ActionResult<EmployeeDto>> Create(SaveEmployeeRequest req, CancellationToken ct) => StatusCode(201, await employees.CreateAsync(req, ct));

    [HttpPut("{id:guid}")]
    public Task<EmployeeDto> Update(Guid id, SaveEmployeeRequest req, CancellationToken ct) => employees.UpdateAsync(id, req, ct);

    [HttpPost("{id:guid}/deactivate")]
    public Task<DeactivateResult> Deactivate(Guid id, DeactivateEmployeeRequest req, CancellationToken ct) => employees.DeactivateAsync(id, req, ct);

    [HttpPost("{id:guid}/reactivate")]
    public Task<EmployeeDto> Reactivate(Guid id, CancellationToken ct) => employees.ReactivateAsync(id, ct);

    [HttpPost("{id:guid}/invite")]
    public Task<InvitationCreatedDto> Invite(Guid id, CancellationToken ct) => invitations.InviteEmployeeAsync(id, ct);

    [HttpPost("{id:guid}/anonymize")]
    public async Task<IActionResult> Anonymize(Guid id, CancellationToken ct)
    {
        await employees.AnonymizeAsync(id, ct);
        return NoContent();
    }

    [HttpGet("{id:guid}/export")]
    public Task<object> Export(Guid id, CancellationToken ct) => employees.ExportAsync(id, ct);
}

public sealed record InvitationTokenRequest(string Token);

[ApiController, Authorize]
[Route("api/v1/invitations")]
public sealed class InvitationsController(InvitationService invitations) : ControllerBase
{
    [HttpGet]
    public Task<IReadOnlyList<InvitationListItemDto>> Pending(CancellationToken ct) => invitations.ListPendingAsync(ct);

    [HttpPost("{id:guid}/revoke")]
    public async Task<IActionResult> Revoke(Guid id, CancellationToken ct)
    {
        await invitations.RevokeAsync(id, ct);
        return NoContent();
    }

    /// <summary>POST instead of GET so the token never appears in URLs or request logs.</summary>
    [HttpPost("lookup"), AllowAnonymous, EnableRateLimiting("auth")]
    public Task<PublicInvitationDto> Lookup(InvitationTokenRequest req, CancellationToken ct) => invitations.GetPublicAsync(req.Token, ct);

    [HttpPost("accept"), AllowAnonymous, EnableRateLimiting("auth")]
    public Task<AcceptInvitationResult> Accept(AcceptInvitationRequest req, CancellationToken ct) => invitations.AcceptAsync(req, ct);
}

[ApiController, Authorize]
[Route("api/v1/availability")]
public sealed class AvailabilityController(AvailabilityService availability) : ControllerBase
{
    [HttpGet]
    public Task<AvailabilityDto> Get([FromQuery] Guid? employeeId, CancellationToken ct) => availability.GetAsync(employeeId, ct);

    [HttpGet("overview")]
    public Task<IReadOnlyList<AvailabilityOverviewItemDto>> Overview([FromQuery] Guid locationId, CancellationToken ct) => availability.OverviewAsync(locationId, ct);

    [HttpPut("weekly")]
    public Task<AvailabilityDto> SaveWeekly(SaveWeeklyAvailabilityRequest req, CancellationToken ct) => availability.SaveWeeklyAsync(req, ct);

    [HttpPost("exceptions")]
    public async Task<ActionResult<AvailabilityExceptionDto>> AddException(CreateAvailabilityExceptionRequest req, CancellationToken ct) =>
        StatusCode(201, await availability.AddExceptionAsync(req, ct));

    [HttpDelete("exceptions/{id:guid}")]
    public async Task<IActionResult> DeleteException(Guid id, CancellationToken ct)
    {
        await availability.DeleteExceptionAsync(id, ct);
        return NoContent();
    }
}

[ApiController, Authorize]
[Route("api/v1/leave-requests")]
public sealed class LeaveRequestsController(LeaveService leave) : ControllerBase
{
    [HttpGet]
    public Task<PagedResult<LeaveRequestDto>> List([FromQuery] LeaveQuery query, CancellationToken ct) => leave.ListAsync(query, ct);

    [HttpGet("{id:guid}")]
    public Task<LeaveRequestDto> Get(Guid id, CancellationToken ct) => leave.GetAsync(id, ct);

    [HttpGet("{id:guid}/conflicts")]
    public Task<LeaveConflictDto> Conflicts(Guid id, CancellationToken ct) => leave.ConflictsAsync(id, ct);

    [HttpPost]
    public async Task<ActionResult<LeaveRequestDto>> Create(CreateLeaveRequest req, CancellationToken ct) => StatusCode(201, await leave.CreateAsync(req, ct));

    [HttpPost("{id:guid}/approve")]
    public Task<LeaveRequestDto> Approve(Guid id, DecideLeaveRequest req, CancellationToken ct) => leave.ApproveAsync(id, req, ct);

    [HttpPost("{id:guid}/reject")]
    public Task<LeaveRequestDto> Reject(Guid id, DecideLeaveRequest req, CancellationToken ct) => leave.RejectAsync(id, req, ct);

    [HttpPost("{id:guid}/cancel")]
    public Task<LeaveRequestDto> Cancel(Guid id, DecideLeaveRequest req, CancellationToken ct) => leave.CancelAsync(id, req, ct);
}

[ApiController, Authorize]
[Route("api/v1/shift-swaps")]
public sealed class ShiftSwapsController(SwapService swaps) : ControllerBase
{
    /// <param name="scope">mine (default) | open | manage</param>
    [HttpGet]
    public Task<IReadOnlyList<SwapDto>> List([FromQuery] string scope = "mine", [FromQuery] bool openOnly = false, CancellationToken ct = default) =>
        swaps.ListAsync(scope, openOnly, ct);

    [HttpGet("eligible-colleagues")]
    public Task<IReadOnlyList<EligibleColleagueDto>> Eligible([FromQuery] Guid shiftId, CancellationToken ct) => swaps.EligibleColleaguesAsync(shiftId, ct);

    [HttpGet("{id:guid}")]
    public Task<SwapDto> Get(Guid id, CancellationToken ct) => swaps.GetAsync(id, ct);

    [HttpPost]
    public async Task<ActionResult<SwapDto>> Create(CreateSwapRequest req, CancellationToken ct) => StatusCode(201, await swaps.CreateAsync(req, ct));

    [HttpPost("{id:guid}/accept")]
    public Task<SwapDto> Accept(Guid id, SwapActionRequest req, CancellationToken ct) => swaps.AcceptAsync(id, req, ct);

    [HttpPost("{id:guid}/decline")]
    public Task<SwapDto> Decline(Guid id, SwapActionRequest req, CancellationToken ct) => swaps.DeclineAsync(id, req, ct);

    [HttpPost("{id:guid}/approve")]
    public Task<SwapDto> Approve(Guid id, SwapActionRequest req, CancellationToken ct) => swaps.ApproveAsync(id, req, ct);

    [HttpPost("{id:guid}/reject")]
    public Task<SwapDto> Reject(Guid id, SwapActionRequest req, CancellationToken ct) => swaps.RejectAsync(id, req, ct);

    [HttpPost("{id:guid}/cancel")]
    public Task<SwapDto> Cancel(Guid id, SwapActionRequest req, CancellationToken ct) => swaps.CancelAsync(id, req, ct);
}
