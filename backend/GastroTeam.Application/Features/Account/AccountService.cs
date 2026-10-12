using GastroTeam.Application.Common;
using GastroTeam.Application.Features.Auth;
using GastroTeam.Domain.Entities;
using FluentValidation;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace GastroTeam.Application.Features.Account;

public sealed record MembershipSummary(Guid TenantId, string TenantName, MembershipRole Role, TenantStatus TenantStatus);

public sealed record CurrentTenantDto(
    Guid Id,
    string Name,
    MembershipRole Role,
    IReadOnlyList<string> Permissions,
    IReadOnlyList<Guid> ManagedLocationIds,
    Guid? EmployeeId,
    TenantStatus Status,
    int OnboardingStep,
    bool OnboardingCompleted,
    SubscriptionSummary Subscription);

public sealed record SubscriptionSummary(string PlanCode, string PlanName, SubscriptionStatus Status, DateTime? TrialEndsAt, bool IsTestMode, IReadOnlyList<string> Features, bool CanWrite);

public sealed record MeDto(
    Guid Id,
    string Email,
    string FirstName,
    string LastName,
    bool EmailConfirmed,
    string PreferredLanguage,
    bool IsPlatformAdmin,
    IReadOnlyList<MembershipSummary> Memberships,
    CurrentTenantDto? CurrentTenant);

public sealed record UpdateProfileRequest(string FirstName, string LastName, string PreferredLanguage, string? Phone);
public sealed record DeleteAccountRequest(string Password);
public sealed record RegisterPushDeviceRequest(string Token, string Platform);

public sealed class UpdateProfileRequestValidator : AbstractValidator<UpdateProfileRequest>
{
    public UpdateProfileRequestValidator()
    {
        RuleFor(x => x.FirstName).NotEmpty().MaximumLength(100);
        RuleFor(x => x.LastName).NotEmpty().MaximumLength(100);
        RuleFor(x => x.PreferredLanguage).Must(l => l is "de-DE" or "en-US" or "bs-BA" or "hr-HR" or "sr-Latn-RS")
            .WithMessage("Diese Sprache wird nicht unterstützt.");
        RuleFor(x => x.Phone).MaximumLength(40);
    }
}

public sealed class RegisterPushDeviceRequestValidator : AbstractValidator<RegisterPushDeviceRequest>
{
    public RegisterPushDeviceRequestValidator()
    {
        RuleFor(x => x.Token).NotEmpty().MaximumLength(300);
        RuleFor(x => x.Platform).Must(p => p is "ios" or "android" or "web");
    }
}

public sealed class AccountService(
    IAppDbContext db,
    Access access,
    UserManager<ApplicationUser> users,
    AuthService auth,
    AuditLogger audit,
    IClock clock)
{
    public async Task<MeDto> GetMeAsync(CancellationToken ct)
    {
        var userId = access.UserId;
        var user = await db.Users.SingleAsync(u => u.Id == userId, ct);
        var memberships = await db.Memberships.IgnoreQueryFilters()
            .Where(m => m.UserId == userId && m.IsActive)
            .OrderBy(m => m.CreatedAt)
            .Select(m => new MembershipSummary(m.TenantId, m.Tenant!.Name, m.Role, m.Tenant.Status))
            .ToListAsync(ct);

        CurrentTenantDto? current = null;
        var c = access.Context;
        if (c.TenantId is { } tenantId)
        {
            var tenant = await db.Tenants.SingleAsync(t => t.Id == tenantId, ct);
            var sub = await db.Subscriptions.Include(s => s.Plan).SingleOrDefaultAsync(ct);
            current = new CurrentTenantDto(
                tenant.Id, tenant.Name, c.Role!.Value,
                PermissionNames(c.EffectivePermissions),
                c.ManagedLocationIds.ToList(),
                c.EmployeeId,
                tenant.Status,
                tenant.OnboardingStep,
                tenant.OnboardingCompletedAt is not null,
                ToSummary(sub, clock.UtcNow));
        }

        return new MeDto(user.Id, user.Email!, user.FirstName, user.LastName, user.EmailConfirmed, user.PreferredLanguage,
            user.IsPlatformAdmin, memberships, current);
    }

    public static SubscriptionSummary ToSummary(Subscription? sub, DateTime now) => sub?.Plan is null
        ? new SubscriptionSummary("none", "Kein Tarif", SubscriptionStatus.Suspended, null, true, [], false)
        : new SubscriptionSummary(sub.PlanCode, sub.Plan.Name, sub.Status, sub.TrialEndsAt, sub.IsTestMode,
            Enum.GetValues<PlanFeatures>().Where(f => f != PlanFeatures.None && sub.Plan.Features.HasFlag(f)).Select(f => f.ToString()).ToList(),
            Entitlements.AllowsWrites(sub.Status, sub.TrialEndsAt, now));

    public static IReadOnlyList<string> PermissionNames(ManagerPermissions p) =>
        Enum.GetValues<ManagerPermissions>()
            .Where(f => f is not ManagerPermissions.None and not ManagerPermissions.All && p.HasFlag(f))
            .Select(f => f.ToString())
            .ToList();

    public async Task UpdateProfileAsync(UpdateProfileRequest req, CancellationToken ct)
    {
        var user = await db.Users.SingleAsync(u => u.Id == access.UserId, ct);
        user.FirstName = req.FirstName.Trim();
        user.LastName = req.LastName.Trim();
        user.PreferredLanguage = req.PreferredLanguage;
        if (access.Context.EmployeeId is { } employeeId)
        {
            var employee = await db.Employees.SingleAsync(e => e.Id == employeeId, ct);
            employee.Phone = req.Phone.NullIfBlank();
            employee.PreferredLanguage = req.PreferredLanguage;
            employee.UpdatedAt = clock.UtcNow;
        }
        await db.SaveChangesAsync(ct);
    }

    /// <summary>GDPR Art. 15/20: personal data of the current user in machine-readable form.</summary>
    public async Task<object> ExportMyDataAsync(CancellationToken ct)
    {
        var userId = access.UserId;
        var user = await db.Users.SingleAsync(u => u.Id == userId, ct);
        var employees = await db.Employees.IgnoreQueryFilters().Where(e => e.UserId == userId)
            .Select(e => new { e.TenantId, e.FirstName, e.LastName, e.Email, e.Phone, e.Status, e.ContractHoursPerWeek, e.EmploymentStartDate, e.EmploymentEndDate, e.CreatedAt })
            .ToListAsync(ct);
        var employeeIds = await db.Employees.IgnoreQueryFilters().Where(e => e.UserId == userId).Select(e => e.Id).ToListAsync(ct);
        var shifts = await db.Shifts.IgnoreQueryFilters()
            .Where(s => s.EmployeeId != null && employeeIds.Contains(s.EmployeeId.Value) && s.Status != ShiftStatus.Draft)
            .Select(s => new { s.TenantId, s.StartUtc, s.EndUtc, s.BreakMinutes, s.Status })
            .ToListAsync(ct);
        var leave = await db.LeaveRequests.IgnoreQueryFilters().Where(l => employeeIds.Contains(l.EmployeeId))
            .Select(l => new { l.TenantId, l.Type, l.StartDate, l.EndDate, l.Status, l.Note, l.CreatedAt })
            .ToListAsync(ct);
        var availability = await db.Availability.IgnoreQueryFilters().Where(a => employeeIds.Contains(a.EmployeeId))
            .Select(a => new { a.DayOfWeek, a.StartTime, a.EndTime, a.Kind, a.ValidFrom, a.ValidTo })
            .ToListAsync(ct);
        var notifications = await db.Notifications.IgnoreQueryFilters().Where(n => n.UserId == userId)
            .Select(n => new { n.Title, n.Body, n.CreatedAt, n.ReadAt })
            .ToListAsync(ct);

        return new
        {
            exportedAt = clock.UtcNow,
            account = new { user.Email, user.FirstName, user.LastName, user.PreferredLanguage, user.CreatedAt, user.LastLoginAt },
            employeeRecords = employees,
            shifts,
            leaveRequests = leave,
            availability,
            notifications
        };
    }

    /// <summary>
    /// Deletes the login and anonymises personal data that is not needed for legitimate business records.
    /// Sole owners must transfer or close their restaurant first.
    /// </summary>
    public async Task DeleteAccountAsync(DeleteAccountRequest req, CancellationToken ct)
    {
        var userId = access.UserId;
        var user = await db.Users.SingleAsync(u => u.Id == userId, ct);
        if (!await users.CheckPasswordAsync(user, req.Password))
            throw RequestValidationException.For("password", "Das Passwort ist falsch.");

        var ownedTenants = await db.Memberships.IgnoreQueryFilters()
            .Where(m => m.UserId == userId && m.IsActive && m.Role == MembershipRole.Owner)
            .Select(m => m.TenantId).ToListAsync(ct);
        foreach (var tenantId in ownedTenants)
        {
            var otherOwners = await db.Memberships.IgnoreQueryFilters()
                .CountAsync(m => m.TenantId == tenantId && m.IsActive && m.Role == MembershipRole.Owner && m.UserId != userId, ct);
            if (otherOwners == 0)
                throw new BusinessRuleException("sole_owner",
                    "Sie sind alleinige Inhaberin bzw. alleiniger Inhaber eines Restaurants. Bitte übertragen Sie die Inhaberschaft oder kündigen Sie das Restaurantkonto über den Support, bevor Sie Ihr Konto löschen.");
        }

        var now = clock.UtcNow;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        foreach (var m in await db.Memberships.IgnoreQueryFilters().Where(m => m.UserId == userId).ToListAsync(ct))
            m.IsActive = false;
        foreach (var e in await db.Employees.IgnoreQueryFilters().Where(e => e.UserId == userId).ToListAsync(ct))
        {
            if (e.Status is EmployeeStatus.Active or EmployeeStatus.Invited) e.Status = EmployeeStatus.Inactive;
            e.Anonymize(now);
        }
        db.PushDevices.RemoveRange(await db.PushDevices.Where(p => p.UserId == userId).ToListAsync(ct));
        await db.Notifications.IgnoreQueryFilters().Where(n => n.UserId == userId).ExecuteDeleteAsync(ct);

        var anon = $"deleted-{user.Id:N}@deleted.invalid";
        user.FirstName = "Gelöschtes";
        user.LastName = "Konto";
        user.Email = anon;
        user.UserName = anon;
        user.NormalizedEmail = anon.ToUpperInvariant();
        user.NormalizedUserName = anon.ToUpperInvariant();
        user.PhoneNumber = null;
        user.PasswordHash = null;
        user.SecurityStamp = Guid.NewGuid().ToString();
        user.IsDeleted = true;
        audit.Log("user.deleted", "User", user.Id, tenantId: null);
        await db.SaveChangesAsync(ct);
        await auth.RevokeAllSessionsAsync(userId, "account_deleted", ct);
        await tx.CommitAsync(ct);
    }

    public async Task RegisterPushDeviceAsync(RegisterPushDeviceRequest req, CancellationToken ct)
    {
        var userId = access.UserId;
        var now = clock.UtcNow;
        var existing = await db.PushDevices.SingleOrDefaultAsync(p => p.Token == req.Token, ct);
        if (existing is null)
            db.PushDevices.Add(new PushDevice { UserId = userId, Token = req.Token, Platform = req.Platform, CreatedAt = now, LastSeenAt = now });
        else
        {
            existing.UserId = userId;
            existing.LastSeenAt = now;
        }
        await db.SaveChangesAsync(ct);
    }

    public async Task RemovePushDeviceAsync(string token, CancellationToken ct)
    {
        var userId = access.UserId;
        await db.PushDevices.Where(p => p.Token == token && p.UserId == userId).ExecuteDeleteAsync(ct);
    }
}
