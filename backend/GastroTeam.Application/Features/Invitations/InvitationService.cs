using System.Net;
using GastroTeam.Application.Common;
using GastroTeam.Application.Features.Auth;
using GastroTeam.Domain.Entities;
using FluentValidation;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace GastroTeam.Application.Features.Invitations;

public sealed record InvitationCreatedDto(Guid InvitationId, string Email, DateTime ExpiresAt, bool EmailSent, string? Link);
public sealed record InvitationListItemDto(Guid Id, string Email, string FullName, MembershipRole Role, Guid? EmployeeId, DateTime ExpiresAt, DateTime CreatedAt);
public sealed record PublicInvitationDto(string TenantName, string Email, string FirstName, string LastName, MembershipRole Role, bool AccountExists, bool IsValid);
public sealed record AcceptInvitationRequest(string Token, string? FirstName, string? LastName, string? Password, bool AcceptTerms);
public sealed record AcceptInvitationResult(Guid TenantId, bool NewAccount, AuthTokens? Tokens);

public sealed record InviteManagerRequest(string Email, string FirstName, string LastName, IReadOnlyList<Guid> LocationIds, IReadOnlyList<string> Permissions);
public sealed record MemberDto(Guid MembershipId, Guid UserId, string FullName, string Email, MembershipRole Role, IReadOnlyList<string> Permissions,
    IReadOnlyList<Guid> LocationIds, bool IsActive, Guid? EmployeeId);
public sealed record UpdateMemberRequest(IReadOnlyList<Guid> LocationIds, IReadOnlyList<string> Permissions, bool IsActive);

public sealed class AcceptInvitationRequestValidator : AbstractValidator<AcceptInvitationRequest>
{
    public AcceptInvitationRequestValidator()
    {
        RuleFor(x => x.Token).NotEmpty().MaximumLength(200);
        RuleFor(x => x.Password).MinimumLength(10).MaximumLength(128).When(x => x.Password is not null)
            .WithMessage("Das Passwort muss mindestens 10 Zeichen lang sein.");
        RuleFor(x => x.FirstName).MaximumLength(100);
        RuleFor(x => x.LastName).MaximumLength(100);
    }
}

public sealed class InviteManagerRequestValidator : AbstractValidator<InviteManagerRequest>
{
    public InviteManagerRequestValidator()
    {
        RuleFor(x => x.Email).NotEmpty().EmailAddress().WithMessage("Bitte geben Sie eine gÃ¼ltige E-Mail-Adresse an.");
        RuleFor(x => x.FirstName).NotEmpty().MaximumLength(100);
        RuleFor(x => x.LastName).NotEmpty().MaximumLength(100);
        RuleFor(x => x.LocationIds).NotEmpty().WithMessage("Bitte wÃ¤hlen Sie mindestens einen Standort.");
        RuleForEach(x => x.Permissions).Must(p => Enum.TryParse<ManagerPermissions>(p, out var v) && v is not ManagerPermissions.None and not ManagerPermissions.All)
            .WithMessage("Unbekannte Berechtigung.");
    }
}

public sealed class InvitationService(
    IAppDbContext db,
    Access access,
    ITokenService tokens,
    IEmailSender email,
    UserManager<ApplicationUser> users,
    AuthService auth,
    AuditLogger audit,
    Notifier notifier,
    IClock clock,
    IOptions<AppOptions> options,
    ILogger<InvitationService> logger)
{
    private readonly AppOptions _opt = options.Value;

    public async Task<InvitationCreatedDto> InviteEmployeeAsync(Guid employeeId, CancellationToken ct)
    {
        access.Require(ManagerPermissions.ManageEmployees);
        access.EnsureWritable();
        var e = await db.Employees.Include(x => x.Locations).SingleOrDefaultAsync(x => x.Id == employeeId, ct) ?? throw new NotFoundException();
        if (!access.Context.IsOwner && !access.ManagesAny(e.Locations.Select(l => l.LocationId))) throw new NotFoundException();
        if (e.Email is null) throw RequestValidationException.For("email", "FÃ¼r eine Einladung wird eine E-Mail-Adresse benÃ¶tigt.");
        if (e.UserId is not null) throw new BusinessRuleException("already_linked", "Diese Person hat bereits Zugang zu GastroTeam.");
        if (e.Status is EmployeeStatus.Inactive or EmployeeStatus.Archived)
            throw new BusinessRuleException("employee_inactive", "Inaktive Mitarbeitende kÃ¶nnen nicht eingeladen werden.");

        e.Status = EmployeeStatus.Invited;
        return await CreateAsync(e.Email, e.FirstName, e.LastName, MembershipRole.Employee, ManagerPermissions.None, e.Id, [], ct);
    }

    public async Task<InvitationCreatedDto> InviteManagerAsync(InviteManagerRequest r, CancellationToken ct)
    {
        access.RequireOwner();
        access.EnsureWritable();
        var ids = r.LocationIds.Distinct().ToList();
        if (await db.Locations.CountAsync(l => ids.Contains(l.Id), ct) != ids.Count)
            throw RequestValidationException.For("locationIds", "Mindestens ein Standort existiert nicht.");
        var perms = ParsePermissions(r.Permissions);
        // Without the advanced-permissions feature managers always receive the full manager permission set.
        if (!access.Plan.Features.HasFlag(PlanFeatures.AdvancedPermissions)) perms = ManagerPermissions.All;
        var existingMember = await db.Memberships.Include(m => m.User)
            .AnyAsync(m => m.User!.NormalizedEmail == r.Email.Trim().ToUpperInvariant() && m.IsActive && m.Role != MembershipRole.Employee, ct);
        if (existingMember) throw new ConflictException("already_member", "Diese Person ist bereits als Leitung in Ihrem Betrieb.");
        return await CreateAsync(r.Email.Trim().ToLowerInvariant(), r.FirstName.Trim(), r.LastName.Trim(), MembershipRole.Manager, perms, null, ids, ct);
    }

    private async Task<InvitationCreatedDto> CreateAsync(string emailAddress, string first, string last, MembershipRole role,
        ManagerPermissions perms, Guid? employeeId, List<Guid> locationIds, CancellationToken ct)
    {
        var now = clock.UtcNow;
        // Only one usable invitation per e-mail and tenant.
        var normalized = emailAddress.ToLowerInvariant();
        foreach (var old in await db.Invitations.Where(i => i.Email == normalized && i.AcceptedAt == null && i.RevokedAt == null).ToListAsync(ct))
            old.RevokedAt = now;

        var raw = tokens.GenerateOpaqueToken();
        var inv = new Invitation
        {
            TenantId = access.TenantId,
            Email = normalized,
            FirstName = first,
            LastName = last,
            Role = role,
            Permissions = perms,
            EmployeeId = employeeId,
            LocationIds = string.Join(',', locationIds),
            TokenHash = tokens.Hash(raw),
            ExpiresAt = now.AddDays(_opt.InvitationValidityDays),
            InvitedByUserId = access.UserId,
            CreatedAt = now,
            UpdatedAt = now
        };
        db.Invitations.Add(inv);
        audit.Log("invitation.created", "Invitation", inv.Id, new { role = role.ToString(), employeeId });
        await db.SaveChangesAsync(ct);

        var tenantName = await db.Tenants.Where(t => t.Id == inv.TenantId).Select(t => t.Name).SingleAsync(ct);
        var link = $"{_opt.WebBaseUrl}/einladung/{raw}";
        var sent = false;
        if (email.IsConfigured)
        {
            try
            {
                var roleText = role == MembershipRole.Manager ? "als Leitung" : "zum Team";
                await email.SendAsync(inv.Email, $"Einladung zu {tenantName} bei GastroTeam",
                    EmailTemplates.Wrap($"Einladung von {tenantName}",
                        $"<p>Hallo {WebUtility.HtmlEncode(first)},</p><p>Sie wurden {roleText} von <strong>{WebUtility.HtmlEncode(tenantName)}</strong> eingeladen. Dort sehen Sie Ihre Schichten, melden VerfÃ¼gbarkeiten und stellen UrlaubsantrÃ¤ge. Der Link ist {_opt.InvitationValidityDays} Tage gÃ¼ltig und kann nur einmal verwendet werden.</p>",
                        link, "Einladung annehmen"),
                    $"Hallo {first},\n\nSie wurden zu {tenantName} bei GastroTeam eingeladen: {link}\n\nDer Link ist {_opt.InvitationValidityDays} Tage gÃ¼ltig.", ct);
                sent = true;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Invitation e-mail for invitation {InvitationId} failed", inv.Id);
            }
        }
        return new InvitationCreatedDto(inv.Id, inv.Email, inv.ExpiresAt, sent, _opt.ExposeInvitationLinkToInviter ? link : null);
    }

    public async Task<IReadOnlyList<InvitationListItemDto>> ListPendingAsync(CancellationToken ct)
    {
        access.Require(ManagerPermissions.ManageEmployees);
        var now = clock.UtcNow;
        return await db.Invitations.Where(i => i.AcceptedAt == null && i.RevokedAt == null && i.ExpiresAt > now)
            .OrderByDescending(i => i.CreatedAt)
            .Select(i => new InvitationListItemDto(i.Id, i.Email, i.FirstName + " " + i.LastName, i.Role, i.EmployeeId, i.ExpiresAt, i.CreatedAt))
            .ToListAsync(ct);
    }

    public async Task RevokeAsync(Guid id, CancellationToken ct)
    {
        access.Require(ManagerPermissions.ManageEmployees);
        var inv = await db.Invitations.SingleOrDefaultAsync(i => i.Id == id, ct) ?? throw new NotFoundException();
        if (inv.Role == MembershipRole.Manager) access.RequireOwner();
        if (inv.AcceptedAt is not null) throw new BusinessRuleException("already_accepted", "Die Einladung wurde bereits angenommen.");
        inv.RevokedAt ??= clock.UtcNow;
        if (inv.EmployeeId is { } empId)
        {
            var e = await db.Employees.SingleOrDefaultAsync(x => x.Id == empId, ct);
            if (e is { Status: EmployeeStatus.Invited, UserId: null }) e.Status = EmployeeStatus.Active;
        }
        audit.Log("invitation.revoked", "Invitation", inv.Id);
        await db.SaveChangesAsync(ct);
    }

    public async Task<PublicInvitationDto> GetPublicAsync(string token, CancellationToken ct)
    {
        var inv = await FindByTokenAsync(token, ct);
        if (inv is null) return new PublicInvitationDto("", "", "", "", MembershipRole.Employee, false, false);
        var tenantName = await db.Tenants.IgnoreQueryFilters().Where(t => t.Id == inv.TenantId).Select(t => t.Name).SingleAsync(ct);
        var exists = await users.FindByEmailAsync(inv.Email) is not null;
        return new PublicInvitationDto(tenantName, inv.Email, inv.FirstName, inv.LastName, inv.Role, exists, inv.IsUsable(clock.UtcNow));
    }

    public async Task<AcceptInvitationResult> AcceptAsync(AcceptInvitationRequest r, CancellationToken ct)
    {
        var now = clock.UtcNow;
        var inv = await FindByTokenAsync(r.Token, ct);
        if (inv is null || !inv.IsUsable(now))
            throw new BusinessRuleException("invitation_invalid", "Diese Einladung ist ungÃ¼ltig, abgelaufen oder wurde bereits verwendet.");
        var tenant = await db.Tenants.IgnoreQueryFilters().SingleAsync(t => t.Id == inv.TenantId, ct);
        if (tenant.Status == TenantStatus.Suspended) throw new ForbiddenException("Dieses Restaurantkonto ist derzeit gesperrt.");

        ApplicationUser user;
        var newAccount = false;
        if (access.Context.UserId is { } currentUserId)
        {
            user = await db.Users.SingleAsync(u => u.Id == currentUserId, ct);
            if (!string.Equals(user.Email, inv.Email, StringComparison.OrdinalIgnoreCase))
                throw new ForbiddenException("Diese Einladung gilt fÃ¼r eine andere E-Mail-Adresse. Bitte melden Sie sich mit dem eingeladenen Konto an.");
        }
        else
        {
            if (await users.FindByEmailAsync(inv.Email) is not null)
                throw new ConflictException("account_exists", "FÃ¼r diese E-Mail-Adresse besteht bereits ein Konto. Bitte melden Sie sich an, um die Einladung anzunehmen.");
            if (string.IsNullOrEmpty(r.Password)) throw RequestValidationException.For("password", "Bitte legen Sie ein Passwort fest.");
            if (!r.AcceptTerms) throw RequestValidationException.For("acceptTerms", "Bitte akzeptieren Sie die Nutzungsbedingungen und die Datenschutzhinweise.");
            user = new ApplicationUser
            {
                Id = Guid.CreateVersion7(),
                Email = inv.Email,
                UserName = inv.Email,
                FirstName = r.FirstName.NullIfBlank() ?? inv.FirstName,
                LastName = r.LastName.NullIfBlank() ?? inv.LastName,
                // The single-use token was delivered to this address (or handed over by the employer).
                EmailConfirmed = true,
                CreatedAt = now
            };
            var created = await users.CreateAsync(user, r.Password);
            if (!created.Succeeded) throw AuthService.IdentityErrors(created);
            newAccount = true;
        }

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var membership = await db.Memberships.IgnoreQueryFilters().Include(m => m.Locations)
            .SingleOrDefaultAsync(m => m.TenantId == inv.TenantId && m.UserId == user.Id, ct);
        if (membership is null)
        {
            membership = new TenantMembership { TenantId = inv.TenantId, UserId = user.Id, Role = inv.Role, Permissions = inv.Permissions, CreatedAt = now, UpdatedAt = now };
            db.Memberships.Add(membership);
        }
        else
        {
            membership.IsActive = true;
            if (inv.Role == MembershipRole.Manager && membership.Role == MembershipRole.Employee)
            {
                membership.Role = MembershipRole.Manager;
                membership.Permissions = inv.Permissions;
            }
            membership.UpdatedAt = now;
        }

        if (inv.Role == MembershipRole.Manager)
        {
            var validLocations = await db.Locations.IgnoreQueryFilters()
                .Where(l => l.TenantId == inv.TenantId && inv.GetLocationIds().Contains(l.Id)).Select(l => l.Id).ToListAsync(ct);
            foreach (var loc in validLocations.Where(l => membership.Locations.All(x => x.LocationId != l)))
                membership.Locations.Add(new MembershipLocation { TenantId = inv.TenantId, MembershipId = membership.Id, LocationId = loc });
        }

        if (inv.EmployeeId is { } employeeId)
        {
            var employee = await db.Employees.IgnoreQueryFilters().SingleAsync(e => e.Id == employeeId && e.TenantId == inv.TenantId, ct);
            if (employee.UserId is not null && employee.UserId != user.Id)
                throw new BusinessRuleException("invitation_invalid", "Dieses Mitarbeiterprofil ist bereits mit einem anderen Konto verknÃ¼pft.");
            if (await db.Employees.IgnoreQueryFilters().AnyAsync(e => e.TenantId == inv.TenantId && e.UserId == user.Id && e.Id != employeeId, ct))
                throw new BusinessRuleException("invitation_invalid", "Ihr Konto ist in diesem Betrieb bereits mit einem anderen Mitarbeiterprofil verknÃ¼pft.");
            employee.UserId = user.Id;
            if (employee.Status == EmployeeStatus.Invited) employee.Status = EmployeeStatus.Active;
            employee.UpdatedAt = now;
        }

        inv.AcceptedAt = now;
        inv.AcceptedByUserId = user.Id;
        audit.Log("invitation.accepted", "Invitation", inv.Id, tenantId: inv.TenantId);
        notifier.Notify(inv.TenantId, [inv.InvitedByUserId], NotificationTypes.Invitation, "Einladung angenommen",
            $"{user.FullName} hat die Einladung angenommen und ist jetzt Teil des Teams.",
            inv.EmployeeId is null ? "/einstellungen" : $"/mitarbeiter/{inv.EmployeeId}");
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);

        var tokensResult = newAccount ? await auth.IssueTokensAsync(user, null, ct) : null;
        return new AcceptInvitationResult(inv.TenantId, newAccount, tokensResult);
    }

    private async Task<Invitation?> FindByTokenAsync(string token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 200) return null;
        var hash = tokens.Hash(token);
        return await db.Invitations.IgnoreQueryFilters().SingleOrDefaultAsync(i => i.TokenHash == hash, ct);
    }

    public static ManagerPermissions ParsePermissions(IEnumerable<string> names) =>
        names.Aggregate(ManagerPermissions.None, (acc, n) => Enum.TryParse<ManagerPermissions>(n, out var p) ? acc | p : acc);
}

public sealed class MemberService(IAppDbContext db, Access access, AuditLogger audit, IClock clock)
{
    public async Task<IReadOnlyList<MemberDto>> ListAsync(CancellationToken ct)
    {
        access.RequireOwner();
        var members = await db.Memberships.Include(m => m.User).Include(m => m.Locations)
            .Where(m => m.Role != MembershipRole.Employee)
            .OrderBy(m => m.Role).ThenBy(m => m.User!.LastName).ToListAsync(ct);
        var employeeIds = await db.Employees.Where(e => e.UserId != null).Select(e => new { e.UserId, e.Id }).ToListAsync(ct);
        return members.Select(m => new MemberDto(m.Id, m.UserId, m.User!.FullName, m.User.Email!, m.Role,
            Account.AccountService.PermissionNames(m.Role == MembershipRole.Owner ? ManagerPermissions.All : m.Permissions),
            m.Locations.Select(l => l.LocationId).ToList(), m.IsActive,
            employeeIds.FirstOrDefault(e => e.UserId == m.UserId)?.Id)).ToList();
    }

    public async Task UpdateAsync(Guid membershipId, UpdateMemberRequest r, CancellationToken ct)
    {
        access.RequireOwner();
        access.EnsureWritable();
        var m = await db.Memberships.Include(x => x.Locations).SingleOrDefaultAsync(x => x.Id == membershipId, ct) ?? throw new NotFoundException();
        if (m.Role == MembershipRole.Owner) throw new BusinessRuleException("owner_immutable", "Die Rechte von Inhaberinnen und Inhabern kÃ¶nnen nicht eingeschrÃ¤nkt werden.");
        if (m.Id == access.Context.MembershipId) throw new BusinessRuleException("self_edit", "Sie kÃ¶nnen Ihre eigenen Rechte nicht Ã¤ndern.");
        var ids = r.LocationIds.Distinct().ToList();
        if (await db.Locations.CountAsync(l => ids.Contains(l.Id), ct) != ids.Count)
            throw RequestValidationException.For("locationIds", "Mindestens ein Standort existiert nicht.");
        var perms = InvitationService.ParsePermissions(r.Permissions);
        if (!access.Plan.Features.HasFlag(PlanFeatures.AdvancedPermissions) && perms != m.Permissions)
            throw new BusinessRuleException("plan_feature_missing", "Individuelle Berechtigungen sind im Tarif Business enthalten.");
        m.Permissions = perms;
        m.IsActive = r.IsActive;
        db.MembershipLocations.RemoveRange(m.Locations.Where(l => !ids.Contains(l.LocationId)));
        foreach (var loc in ids.Where(l => m.Locations.All(x => x.LocationId != l)))
            db.MembershipLocations.Add(new MembershipLocation { TenantId = m.TenantId, MembershipId = m.Id, LocationId = loc });
        m.UpdatedAt = clock.UtcNow;
        audit.Log("member.updated", "Membership", m.Id, new { r.Permissions, r.LocationIds, r.IsActive });
        await db.SaveChangesAsync(ct);
    }
}
