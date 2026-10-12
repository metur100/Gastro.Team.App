using GastroTeam.Application.Common;
using GastroTeam.Domain.Entities;
using GastroTeam.Domain.Scheduling;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace GastroTeam.Application.Features.Tenants;

public sealed record CreateBusinessRequest(string Name, string? ContactEmail, string? Phone, string TimeZone);
public sealed record OnboardingStateDto(int Step, bool Completed, int Locations, int Employees, int Shifts, int PublishedShifts, int OpeningHoursConfigured);
public sealed record SaveOnboardingStepRequest(int Step);

public sealed record TenantSettingsDto(
    string Name, string? ContactEmail, string? Phone, string? LogoUrl, string DefaultLanguage, string DefaultTimeZone,
    bool UnassignedShiftsBlockPublish, decimal MaxShiftHours, decimal MaxDailyHours, decimal MaxWeeklyHours, decimal MinRestHours,
    bool CheckBreakRules, bool SwapRequiresManagerApproval, bool AllowOpenSwapOffers, bool EmployeesSeeColleagueShifts, string RuleSetVersion);

public sealed record UpdateTenantSettingsRequest(
    string Name, string? ContactEmail, string? Phone, string? LogoUrl, string DefaultLanguage, string DefaultTimeZone,
    bool UnassignedShiftsBlockPublish, decimal MaxShiftHours, decimal MaxDailyHours, decimal MaxWeeklyHours, decimal MinRestHours,
    bool CheckBreakRules, bool SwapRequiresManagerApproval, bool AllowOpenSwapOffers, bool EmployeesSeeColleagueShifts);

public sealed class CreateBusinessRequestValidator : AbstractValidator<CreateBusinessRequest>
{
    public CreateBusinessRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().WithMessage("Bitte geben Sie den Namen Ihres Betriebs an.").MaximumLength(150);
        RuleFor(x => x.ContactEmail).EmailAddress().When(x => !string.IsNullOrWhiteSpace(x.ContactEmail)).WithMessage("Ungültige E-Mail-Adresse.");
        RuleFor(x => x.Phone).MaximumLength(40);
        RuleFor(x => x.TimeZone).Must(ZonedTime.IsValidZone).WithMessage("Die Zeitzone ist ungültig.");
    }
}

public sealed class UpdateTenantSettingsRequestValidator : AbstractValidator<UpdateTenantSettingsRequest>
{
    public UpdateTenantSettingsRequestValidator()
    {
        RuleFor(x => x.Name).NotEmpty().MaximumLength(150);
        RuleFor(x => x.ContactEmail).EmailAddress().When(x => !string.IsNullOrWhiteSpace(x.ContactEmail));
        RuleFor(x => x.LogoUrl).Must(u => Uri.TryCreate(u, UriKind.Absolute, out var uri) && uri.Scheme == "https")
            .When(x => !string.IsNullOrWhiteSpace(x.LogoUrl)).WithMessage("Bitte geben Sie eine https-Adresse an.");
        RuleFor(x => x.DefaultLanguage).Must(l => l is "de-DE" or "en-US");
        RuleFor(x => x.DefaultTimeZone).Must(ZonedTime.IsValidZone).WithMessage("Die Zeitzone ist ungültig.");
        RuleFor(x => x.MaxShiftHours).InclusiveBetween(1, 16);
        RuleFor(x => x.MaxDailyHours).InclusiveBetween(1, 16);
        RuleFor(x => x.MaxWeeklyHours).InclusiveBetween(1, 80);
        RuleFor(x => x.MinRestHours).InclusiveBetween(0, 24);
    }
}

public sealed class OnboardingService(IAppDbContext db, Access access, AuditLogger audit, IClock clock, IOptions<AppOptions> options)
{
    public static readonly (string Name, string Color)[] DefaultRoles =
        [("Service", "#0F766E"), ("Küche", "#B45309"), ("Bar", "#7C3AED"), ("Schichtleitung", "#1D4ED8")];

    public async Task<Guid> CreateBusinessAsync(CreateBusinessRequest req, CancellationToken ct)
    {
        var userId = access.UserId;
        var user = await db.Users.SingleAsync(u => u.Id == userId, ct);
        if (options.Value.RequireEmailVerification && !user.EmailConfirmed)
            throw new BusinessRuleException("email_not_verified", "Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse.");

        var ownsAlready = await db.Memberships.IgnoreQueryFilters()
            .CountAsync(m => m.UserId == userId && m.Role == MembershipRole.Owner && m.IsActive, ct);
        if (ownsAlready >= 5) throw new BusinessRuleException("too_many_tenants", "Sie können höchstens fünf Betriebe anlegen.");

        var plan = await db.SubscriptionPlans.SingleAsync(p => p.Code == options.Value.TrialPlanCode, ct);
        var now = clock.UtcNow;
        var tenant = new Tenant
        {
            Name = req.Name.Trim(),
            ContactEmail = req.ContactEmail.NullIfBlank() ?? user.Email,
            Phone = req.Phone.NullIfBlank(),
            DefaultTimeZone = req.TimeZone,
            OnboardingStep = 1,
            CreatedAt = now,
            UpdatedAt = now
        };
        db.Tenants.Add(tenant);
        db.TenantSettings.Add(new TenantSettings { TenantId = tenant.Id, UpdatedAt = now });
        db.Subscriptions.Add(new Subscription
        {
            TenantId = tenant.Id,
            PlanCode = plan.Code,
            Status = SubscriptionStatus.Trial,
            TrialEndsAt = now.AddDays(options.Value.TrialDays),
            IsTestMode = true,
            CreatedAt = now,
            UpdatedAt = now
        });
        db.Memberships.Add(new TenantMembership
        {
            TenantId = tenant.Id,
            UserId = userId,
            Role = MembershipRole.Owner,
            Permissions = ManagerPermissions.All,
            CreatedAt = now,
            UpdatedAt = now
        });
        var order = 0;
        foreach (var (name, color) in DefaultRoles)
            db.JobRoles.Add(new JobRole { TenantId = tenant.Id, Name = name, Color = color, SortOrder = order++, CreatedAt = now, UpdatedAt = now });

        audit.Log("tenant.created", "Tenant", tenant.Id, new { tenant.Name }, tenant.Id);
        await db.SaveChangesAsync(ct);
        return tenant.Id;
    }

    public async Task<OnboardingStateDto> GetStateAsync(CancellationToken ct)
    {
        access.RequireManager();
        var tenant = await db.Tenants.SingleAsync(t => t.Id == access.TenantId, ct);
        return new OnboardingStateDto(
            tenant.OnboardingStep,
            tenant.OnboardingCompletedAt is not null,
            await db.Locations.CountAsync(ct),
            await db.Employees.CountAsync(e => e.Status != EmployeeStatus.Archived, ct),
            await db.Shifts.CountAsync(s => s.Status != ShiftStatus.Cancelled, ct),
            await db.Shifts.CountAsync(s => s.Status == ShiftStatus.Published, ct),
            await db.OpeningHours.CountAsync(ct));
    }

    public async Task SaveStepAsync(int step, CancellationToken ct)
    {
        access.RequireOwner();
        var tenant = await db.Tenants.SingleAsync(t => t.Id == access.TenantId, ct);
        tenant.OnboardingStep = Math.Clamp(step, 1, 6);
        tenant.UpdatedAt = clock.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    public async Task CompleteAsync(CancellationToken ct)
    {
        access.RequireOwner();
        var tenant = await db.Tenants.SingleAsync(t => t.Id == access.TenantId, ct);
        tenant.OnboardingStep = 6;
        tenant.OnboardingCompletedAt ??= clock.UtcNow;
        audit.Log("tenant.onboarding_completed", "Tenant", tenant.Id);
        await db.SaveChangesAsync(ct);
    }
}

public sealed class TenantSettingsService(IAppDbContext db, Access access, AuditLogger audit, IClock clock)
{
    public async Task<TenantSettingsDto> GetAsync(CancellationToken ct)
    {
        access.RequireManager();
        var t = await db.Tenants.SingleAsync(x => x.Id == access.TenantId, ct);
        var s = await db.TenantSettings.SingleAsync(ct);
        return new TenantSettingsDto(t.Name, t.ContactEmail, t.Phone, t.LogoUrl, t.DefaultLanguage, t.DefaultTimeZone,
            s.UnassignedShiftsBlockPublish, s.MaxShiftHours, s.MaxDailyHours, s.MaxWeeklyHours, s.MinRestHours,
            s.CheckBreakRules, s.SwapRequiresManagerApproval, s.AllowOpenSwapOffers, s.EmployeesSeeColleagueShifts, s.RuleSetVersion);
    }

    public async Task<TenantSettingsDto> UpdateAsync(UpdateTenantSettingsRequest r, CancellationToken ct)
    {
        access.RequireOwner();
        access.EnsureWritable();
        var t = await db.Tenants.SingleAsync(x => x.Id == access.TenantId, ct);
        var s = await db.TenantSettings.SingleAsync(ct);
        var now = clock.UtcNow;
        t.Name = r.Name.Trim();
        t.ContactEmail = r.ContactEmail.NullIfBlank();
        t.Phone = r.Phone.NullIfBlank();
        t.LogoUrl = r.LogoUrl.NullIfBlank();
        t.DefaultLanguage = r.DefaultLanguage;
        t.DefaultTimeZone = r.DefaultTimeZone;
        t.UpdatedAt = now;
        s.UnassignedShiftsBlockPublish = r.UnassignedShiftsBlockPublish;
        s.MaxShiftHours = r.MaxShiftHours;
        s.MaxDailyHours = r.MaxDailyHours;
        s.MaxWeeklyHours = r.MaxWeeklyHours;
        s.MinRestHours = r.MinRestHours;
        s.CheckBreakRules = r.CheckBreakRules;
        s.SwapRequiresManagerApproval = r.SwapRequiresManagerApproval;
        s.AllowOpenSwapOffers = r.AllowOpenSwapOffers;
        s.EmployeesSeeColleagueShifts = r.EmployeesSeeColleagueShifts;
        s.UpdatedAt = now;
        audit.Log("tenant.settings_updated", "Tenant", t.Id, r);
        await db.SaveChangesAsync(ct);
        return await GetAsync(ct);
    }
}
