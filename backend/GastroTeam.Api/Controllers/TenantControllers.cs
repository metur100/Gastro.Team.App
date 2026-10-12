using GastroTeam.Application.Common;
using GastroTeam.Application.Features.Account;
using GastroTeam.Application.Features.Billing;
using GastroTeam.Application.Features.Invitations;
using GastroTeam.Application.Features.Locations;
using GastroTeam.Application.Features.Tenants;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace GastroTeam.Api.Controllers;

[ApiController, Authorize]
[Route("api/v1/me")]
public sealed class MeController(AccountService account) : ControllerBase
{
    [HttpPut("profile")]
    public async Task<IActionResult> UpdateProfile(UpdateProfileRequest req, CancellationToken ct)
    {
        await account.UpdateProfileAsync(req, ct);
        return NoContent();
    }

    [HttpGet("export")]
    public Task<object> Export(CancellationToken ct) => account.ExportMyDataAsync(ct);

    [HttpPost("delete-account"), EnableRateLimiting("auth")]
    public async Task<IActionResult> DeleteAccount(DeleteAccountRequest req, CancellationToken ct)
    {
        await account.DeleteAccountAsync(req, ct);
        return NoContent();
    }

    [HttpPost("push-devices")]
    public async Task<IActionResult> RegisterPush(RegisterPushDeviceRequest req, CancellationToken ct)
    {
        await account.RegisterPushDeviceAsync(req, ct);
        return NoContent();
    }

    [HttpDelete("push-devices")]
    public async Task<IActionResult> RemovePush([FromQuery] string token, CancellationToken ct)
    {
        await account.RemovePushDeviceAsync(token, ct);
        return NoContent();
    }
}

[ApiController, Authorize]
[Route("api/v1/onboarding")]
public sealed class OnboardingController(OnboardingService onboarding) : ControllerBase
{
    [HttpPost("business")]
    public async Task<ActionResult<object>> CreateBusiness(CreateBusinessRequest req, CancellationToken ct) =>
        StatusCode(201, new { tenantId = await onboarding.CreateBusinessAsync(req, ct) });

    [HttpGet]
    public Task<OnboardingStateDto> Get(CancellationToken ct) => onboarding.GetStateAsync(ct);

    [HttpPut("step")]
    public async Task<IActionResult> SaveStep(SaveOnboardingStepRequest req, CancellationToken ct)
    {
        await onboarding.SaveStepAsync(req.Step, ct);
        return NoContent();
    }

    [HttpPost("complete")]
    public async Task<IActionResult> Complete(CancellationToken ct)
    {
        await onboarding.CompleteAsync(ct);
        return NoContent();
    }
}

[ApiController, Authorize]
[Route("api/v1/settings")]
public sealed class SettingsController(TenantSettingsService settings, MemberService members, InvitationService invitations, AuditQueryService audit) : ControllerBase
{
    [HttpGet("tenant")]
    public Task<TenantSettingsDto> Get(CancellationToken ct) => settings.GetAsync(ct);

    [HttpPut("tenant")]
    public Task<TenantSettingsDto> Update(UpdateTenantSettingsRequest req, CancellationToken ct) => settings.UpdateAsync(req, ct);

    [HttpGet("members")]
    public Task<IReadOnlyList<MemberDto>> Members(CancellationToken ct) => members.ListAsync(ct);

    [HttpPost("members/invite")]
    public Task<InvitationCreatedDto> InviteManager(InviteManagerRequest req, CancellationToken ct) => invitations.InviteManagerAsync(req, ct);

    [HttpPut("members/{id:guid}")]
    public async Task<IActionResult> UpdateMember(Guid id, UpdateMemberRequest req, CancellationToken ct)
    {
        await members.UpdateAsync(id, req, ct);
        return NoContent();
    }

    [HttpGet("audit-log")]
    public Task<PagedResult<AuditLogDto>> AuditLog([FromQuery] int page = 1, [FromQuery] int pageSize = 50, [FromQuery] string? entityType = null, CancellationToken ct = default) =>
        audit.ListAsync(page, pageSize, entityType, ct);
}

[ApiController, Authorize]
[Route("api/v1/locations")]
public sealed class LocationsController(LocationService locations) : ControllerBase
{
    [HttpGet]
    public Task<IReadOnlyList<LocationDto>> List([FromQuery] bool includeInactive = false, CancellationToken ct = default) => locations.ListAsync(includeInactive, ct);

    [HttpGet("{id:guid}")]
    public Task<LocationDto> Get(Guid id, CancellationToken ct) => locations.GetAsync(id, ct);

    [HttpPost]
    public async Task<ActionResult<LocationDto>> Create(SaveLocationRequest req, CancellationToken ct) => StatusCode(201, await locations.CreateAsync(req, ct));

    [HttpPut("{id:guid}")]
    public Task<LocationDto> Update(Guid id, SaveLocationRequest req, CancellationToken ct) => locations.UpdateAsync(id, req, ct);

    [HttpPut("{id:guid}/opening-hours")]
    public Task<LocationDto> OpeningHours(Guid id, SaveOpeningHoursRequest req, CancellationToken ct) => locations.SaveOpeningHoursAsync(id, req, ct);
}

[ApiController, Authorize]
[Route("api/v1/job-roles")]
public sealed class JobRolesController(JobRoleService roles) : ControllerBase
{
    [HttpGet]
    public Task<IReadOnlyList<JobRoleDto>> List(CancellationToken ct) => roles.ListAsync(ct);

    [HttpPost]
    public async Task<ActionResult<JobRoleDto>> Create(SaveJobRoleRequest req, CancellationToken ct) => StatusCode(201, await roles.CreateAsync(req, ct));

    [HttpPut("{id:guid}")]
    public Task<JobRoleDto> Update(Guid id, SaveJobRoleRequest req, CancellationToken ct) => roles.UpdateAsync(id, req, ct);
}

[ApiController, Authorize]
[Route("api/v1/subscription")]
public sealed class SubscriptionController(SubscriptionService subscriptions) : ControllerBase
{
    [HttpGet]
    public Task<SubscriptionDto> Get(CancellationToken ct) => subscriptions.GetAsync(ct);

    [HttpPost("change-plan")]
    public Task<SubscriptionDto> ChangePlan(ChangePlanRequest req, CancellationToken ct) => subscriptions.ChangePlanAsync(req, ct);
}

[ApiController, Authorize]
[Route("api/v1/platform")]
public sealed class PlatformController(PlatformService platform) : ControllerBase
{
    [HttpGet("tenants")]
    public Task<IReadOnlyList<TenantAdminDto>> Tenants(CancellationToken ct) => platform.ListTenantsAsync(ct);

    [HttpPost("tenants/{id:guid}/suspend")]
    public async Task<IActionResult> Suspend(Guid id, SuspendTenantRequest req, CancellationToken ct)
    {
        await platform.SetStatusAsync(id, true, req.Reason, ct);
        return NoContent();
    }

    [HttpPost("tenants/{id:guid}/reactivate")]
    public async Task<IActionResult> Reactivate(Guid id, CancellationToken ct)
    {
        await platform.SetStatusAsync(id, false, null, ct);
        return NoContent();
    }

    [HttpGet("audit")]
    public Task<IReadOnlyList<AuditLogDto>> Audit(CancellationToken ct) => platform.PlatformAuditAsync(ct);
}
