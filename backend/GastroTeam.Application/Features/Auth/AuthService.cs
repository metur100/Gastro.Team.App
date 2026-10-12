using System.Net;
using GastroTeam.Application.Common;
using GastroTeam.Domain.Entities;
using FluentValidation;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace GastroTeam.Application.Features.Auth;

public sealed record RegisterRequest(string Email, string Password, string FirstName, string LastName, bool AcceptTerms);
public sealed record LoginRequest(string Email, string Password);
public sealed record ForgotPasswordRequest(string Email);
public sealed record ResetPasswordRequest(string Email, string Token, string NewPassword);
public sealed record VerifyEmailRequest(Guid UserId, string Token);
public sealed record ResendVerificationRequest(string Email);
public sealed record ChangePasswordRequest(string CurrentPassword, string NewPassword);

public sealed record AuthTokens(string AccessToken, DateTime AccessTokenExpiresAt, string RefreshToken, DateTime RefreshTokenExpiresAt);
public sealed record RegisterResult(bool RequiresEmailVerification, AuthTokens? Tokens);

public sealed class RegisterRequestValidator : AbstractValidator<RegisterRequest>
{
    public RegisterRequestValidator()
    {
        RuleFor(x => x.Email).NotEmpty().WithMessage("Bitte geben Sie eine E-Mail-Adresse an.")
            .EmailAddress().WithMessage("Bitte geben Sie eine gültige E-Mail-Adresse an.").MaximumLength(256);
        RuleFor(x => x.Password).NotEmpty().MinimumLength(10).WithMessage("Das Passwort muss mindestens 10 Zeichen lang sein.")
            .MaximumLength(128);
        RuleFor(x => x.FirstName).NotEmpty().WithMessage("Bitte geben Sie Ihren Vornamen an.").MaximumLength(100);
        RuleFor(x => x.LastName).NotEmpty().WithMessage("Bitte geben Sie Ihren Nachnamen an.").MaximumLength(100);
        RuleFor(x => x.AcceptTerms).Equal(true).WithMessage("Bitte akzeptieren Sie die Nutzungsbedingungen und die Datenschutzhinweise.");
    }
}

public sealed class LoginRequestValidator : AbstractValidator<LoginRequest>
{
    public LoginRequestValidator()
    {
        RuleFor(x => x.Email).NotEmpty().WithMessage("Bitte geben Sie Ihre E-Mail-Adresse an.").MaximumLength(256);
        RuleFor(x => x.Password).NotEmpty().WithMessage("Bitte geben Sie Ihr Passwort ein.").MaximumLength(128);
    }
}

public sealed class ResetPasswordRequestValidator : AbstractValidator<ResetPasswordRequest>
{
    public ResetPasswordRequestValidator()
    {
        RuleFor(x => x.Email).NotEmpty().EmailAddress();
        RuleFor(x => x.Token).NotEmpty();
        RuleFor(x => x.NewPassword).MinimumLength(10).WithMessage("Das Passwort muss mindestens 10 Zeichen lang sein.").MaximumLength(128);
    }
}

public sealed class ChangePasswordRequestValidator : AbstractValidator<ChangePasswordRequest>
{
    public ChangePasswordRequestValidator()
    {
        RuleFor(x => x.CurrentPassword).NotEmpty();
        RuleFor(x => x.NewPassword).MinimumLength(10).WithMessage("Das Passwort muss mindestens 10 Zeichen lang sein.").MaximumLength(128);
    }
}

public sealed class AuthOptions
{
    public const string Section = "Auth";
    public int RefreshTokenDays { get; set; } = 14;
    /// <summary>Absolute lifetime of a login session regardless of refreshes.</summary>
    public int SessionMaxDays { get; set; } = 30;
}

public sealed class AuthService(
    IAppDbContext db,
    UserManager<ApplicationUser> users,
    ITokenService tokens,
    IEmailSender email,
    IClock clock,
    RequestContext ctx,
    AuditLogger audit,
    IOptions<AppOptions> appOptions,
    IOptions<AuthOptions> authOptions,
    ILogger<AuthService> logger)
{
    private readonly AppOptions _app = appOptions.Value;
    private readonly AuthOptions _auth = authOptions.Value;

    private static UnauthorizedException InvalidCredentials() =>
        new("invalid_credentials", "E-Mail-Adresse oder Passwort ist falsch.");

    public async Task<RegisterResult> RegisterAsync(RegisterRequest req, CancellationToken ct)
    {
        var existing = await users.FindByEmailAsync(req.Email.Trim());
        if (existing is not null)
            throw new ConflictException("email_taken", "Für diese E-Mail-Adresse besteht bereits ein Konto. Bitte melden Sie sich an.");

        var user = new ApplicationUser
        {
            Id = Guid.CreateVersion7(),
            UserName = req.Email.Trim(),
            Email = req.Email.Trim(),
            FirstName = req.FirstName.Trim(),
            LastName = req.LastName.Trim(),
            CreatedAt = clock.UtcNow,
            EmailConfirmed = false
        };
        var result = await users.CreateAsync(user, req.Password);
        if (!result.Succeeded) throw IdentityErrors(result);

        audit.Log("user.registered", "User", user.Id, tenantId: null);
        await db.SaveChangesAsync(ct);
        await SendVerificationEmailAsync(user, ct);

        if (_app.RequireEmailVerification) return new RegisterResult(true, null);
        return new RegisterResult(false, await IssueTokensAsync(user, null, ct));
    }

    public async Task SendVerificationEmailAsync(ApplicationUser user, CancellationToken ct)
    {
        var token = await users.GenerateEmailConfirmationTokenAsync(user);
        var link = $"{_app.WebBaseUrl}/email-bestaetigen?userId={user.Id}&token={Uri.EscapeDataString(token)}";
        await TrySendAsync(user.Email!, "Bitte bestätigen Sie Ihre E-Mail-Adresse",
            EmailTemplates.Wrap("E-Mail-Adresse bestätigen",
                $"<p>Hallo {WebUtility.HtmlEncode(user.FirstName)},</p><p>willkommen bei GastroTeam! Bitte bestätigen Sie Ihre E-Mail-Adresse.</p>",
                link, "E-Mail-Adresse bestätigen"),
            $"Hallo {user.FirstName},\n\nbitte bestätigen Sie Ihre E-Mail-Adresse: {link}", ct);
    }

    public async Task VerifyEmailAsync(VerifyEmailRequest req, CancellationToken ct)
    {
        var user = await users.FindByIdAsync(req.UserId.ToString());
        if (user is null) throw new BusinessRuleException("invalid_token", "Der Bestätigungslink ist ungültig oder abgelaufen.");
        if (user.EmailConfirmed) return;
        var result = await users.ConfirmEmailAsync(user, req.Token);
        if (!result.Succeeded) throw new BusinessRuleException("invalid_token", "Der Bestätigungslink ist ungültig oder abgelaufen.");
        audit.Log("user.email_verified", "User", user.Id, tenantId: null);
        await db.SaveChangesAsync(ct);
    }

    public async Task ResendVerificationAsync(string emailAddress, CancellationToken ct)
    {
        var user = await users.FindByEmailAsync(emailAddress.Trim());
        if (user is null || user.EmailConfirmed || user.IsDeleted) return; // do not reveal account existence
        await SendVerificationEmailAsync(user, ct);
    }

    public async Task<AuthTokens> LoginAsync(LoginRequest req, CancellationToken ct)
    {
        var user = await users.FindByEmailAsync(req.Email.Trim());
        if (user is null || user.IsDeleted)
        {
            // Spend comparable time to make account enumeration via timing harder.
            new PasswordHasher<ApplicationUser>().HashPassword(new ApplicationUser(), req.Password);
            throw InvalidCredentials();
        }

        if (await users.IsLockedOutAsync(user))
            throw new UnauthorizedException("locked_out", "Zu viele fehlgeschlagene Anmeldeversuche. Bitte versuchen Sie es in 15 Minuten erneut.");

        if (!await users.CheckPasswordAsync(user, req.Password))
        {
            await users.AccessFailedAsync(user);
            logger.LogWarning("Failed login for user {UserId}", user.Id);
            audit.Log("user.login_failed", "User", user.Id, tenantId: null);
            await db.SaveChangesAsync(ct);
            throw InvalidCredentials();
        }

        if (_app.RequireEmailVerification && !user.EmailConfirmed)
            throw new UnauthorizedException("email_not_verified", "Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse. Wir haben Ihnen einen Link geschickt.");

        await users.ResetAccessFailedCountAsync(user);
        user.LastLoginAt = clock.UtcNow;
        if (_app.PlatformAdminEmails.Contains(user.Email, StringComparer.OrdinalIgnoreCase) && user.EmailConfirmed)
            user.IsPlatformAdmin = true;
        await users.UpdateAsync(user);
        audit.Log("user.login", "User", user.Id, tenantId: null);
        return await IssueTokensAsync(user, null, ct);
    }

    public async Task<AuthTokens> RefreshAsync(string rawToken, CancellationToken ct)
    {
        var now = clock.UtcNow;
        var hash = tokens.Hash(rawToken);
        var stored = await db.RefreshTokens.SingleOrDefaultAsync(t => t.TokenHash == hash, ct);
        if (stored is null) throw new UnauthorizedException("invalid_session", "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.");

        if (stored.RevokedAt is not null)
        {
            // Reuse of a rotated or revoked token: assume theft and revoke the whole family.
            if (stored.ReplacedByTokenId is not null)
            {
                await RevokeFamilyAsync(stored.FamilyId, "reuse_detected", ct);
                logger.LogWarning("Refresh token reuse detected for user {UserId}", stored.UserId);
                audit.Log("session.reuse_detected", "User", stored.UserId, tenantId: null);
                await db.SaveChangesAsync(ct);
            }
            throw new UnauthorizedException("invalid_session", "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.");
        }

        if (stored.ExpiresAt <= now || stored.FamilyCreatedAt.AddDays(_auth.SessionMaxDays) <= now)
            throw new UnauthorizedException("invalid_session", "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.");

        var user = await users.FindByIdAsync(stored.UserId.ToString());
        if (user is null || user.IsDeleted || await users.IsLockedOutAsync(user))
            throw new UnauthorizedException("invalid_session", "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.");

        return await IssueTokensAsync(user, stored, ct);
    }

    public async Task LogoutAsync(string? rawToken, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(rawToken)) return;
        var hash = tokens.Hash(rawToken);
        var stored = await db.RefreshTokens.SingleOrDefaultAsync(t => t.TokenHash == hash, ct);
        if (stored is null) return;
        await RevokeFamilyAsync(stored.FamilyId, "logout", ct);
        await db.SaveChangesAsync(ct);
    }

    public async Task RevokeAllSessionsAsync(Guid userId, string reason, CancellationToken ct)
    {
        var now = clock.UtcNow;
        await db.RefreshTokens.Where(t => t.UserId == userId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now).SetProperty(t => t.RevokedReason, reason), ct);
    }

    public async Task ForgotPasswordAsync(string emailAddress, CancellationToken ct)
    {
        var user = await users.FindByEmailAsync(emailAddress.Trim());
        if (user is null || user.IsDeleted) return; // identical response to avoid account enumeration
        var token = await users.GeneratePasswordResetTokenAsync(user);
        var link = $"{_app.WebBaseUrl}/passwort-zuruecksetzen?email={Uri.EscapeDataString(user.Email!)}&token={Uri.EscapeDataString(token)}";
        await TrySendAsync(user.Email!, "Passwort zurücksetzen",
            EmailTemplates.Wrap("Passwort zurücksetzen",
                "<p>Sie haben angefordert, Ihr Passwort zurückzusetzen. Der Link ist 2 Stunden gültig. Falls Sie das nicht waren, können Sie diese E-Mail ignorieren.</p>",
                link, "Neues Passwort festlegen"),
            $"Passwort zurücksetzen: {link}", ct);
        audit.Log("user.password_reset_requested", "User", user.Id, tenantId: null);
        await db.SaveChangesAsync(ct);
    }

    public async Task ResetPasswordAsync(ResetPasswordRequest req, CancellationToken ct)
    {
        var user = await users.FindByEmailAsync(req.Email.Trim());
        if (user is null) throw new BusinessRuleException("invalid_token", "Der Link ist ungültig oder abgelaufen.");
        var result = await users.ResetPasswordAsync(user, req.Token, req.NewPassword);
        if (!result.Succeeded)
        {
            if (result.Errors.Any(e => e.Code == "InvalidToken"))
                throw new BusinessRuleException("invalid_token", "Der Link ist ungültig oder abgelaufen.");
            throw IdentityErrors(result);
        }
        // Possession of the reset link proves access to the mailbox.
        if (!user.EmailConfirmed) { user.EmailConfirmed = true; await users.UpdateAsync(user); }
        await users.SetLockoutEndDateAsync(user, null);
        await RevokeAllSessionsAsync(user.Id, "password_reset", ct);
        audit.Log("user.password_reset", "User", user.Id, tenantId: null);
        await db.SaveChangesAsync(ct);
    }

    public async Task ChangePasswordAsync(ChangePasswordRequest req, CancellationToken ct)
    {
        var userId = ctx.UserId ?? throw new UnauthorizedException("unauthenticated", "Bitte melden Sie sich an.");
        var user = await users.FindByIdAsync(userId.ToString()) ?? throw new NotFoundException();
        var result = await users.ChangePasswordAsync(user, req.CurrentPassword, req.NewPassword);
        if (!result.Succeeded)
        {
            if (result.Errors.Any(e => e.Code == "PasswordMismatch"))
                throw RequestValidationException.For("currentPassword", "Das aktuelle Passwort ist falsch.");
            throw IdentityErrors(result);
        }
        await RevokeAllSessionsAsync(user.Id, "password_changed", ct);
        audit.Log("user.password_changed", "User", user.Id, tenantId: null);
        await db.SaveChangesAsync(ct);
    }

    public async Task<AuthTokens> IssueTokensAsync(ApplicationUser user, RefreshToken? rotateFrom, CancellationToken ct)
    {
        var now = clock.UtcNow;
        var (access, accessExpires) = tokens.CreateAccessToken(user);
        var raw = tokens.GenerateOpaqueToken();
        var refresh = new RefreshToken
        {
            UserId = user.Id,
            TokenHash = tokens.Hash(raw),
            FamilyId = rotateFrom?.FamilyId ?? Guid.CreateVersion7(),
            FamilyCreatedAt = rotateFrom?.FamilyCreatedAt ?? now,
            CreatedAt = now,
            ExpiresAt = now.AddDays(_auth.RefreshTokenDays),
            CreatedByIp = ctx.IpAddress,
            UserAgent = ctx.UserAgent is { Length: > 300 } ua ? ua[..300] : ctx.UserAgent
        };
        var absoluteEnd = refresh.FamilyCreatedAt.AddDays(_auth.SessionMaxDays);
        if (refresh.ExpiresAt > absoluteEnd) refresh.ExpiresAt = absoluteEnd;

        if (rotateFrom is not null)
        {
            rotateFrom.RevokedAt = now;
            rotateFrom.RevokedReason = "rotated";
            rotateFrom.ReplacedByTokenId = refresh.Id;
        }
        db.RefreshTokens.Add(refresh);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Two parallel refreshes with the same token: only one may win.
            throw new UnauthorizedException("invalid_session", "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.");
        }
        return new AuthTokens(access, accessExpires, raw, refresh.ExpiresAt);
    }

    private async Task RevokeFamilyAsync(Guid familyId, string reason, CancellationToken ct)
    {
        var now = clock.UtcNow;
        await db.RefreshTokens.Where(t => t.FamilyId == familyId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now).SetProperty(t => t.RevokedReason, reason), ct);
    }

    private async Task TrySendAsync(string to, string subject, string html, string text, CancellationToken ct)
    {
        try
        {
            await email.SendAsync(to, subject, html, text, ct);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Sending e-mail '{Subject}' failed", subject);
        }
    }

    internal static RequestValidationException IdentityErrors(IdentityResult result)
    {
        var messages = result.Errors.Select(e => e.Code switch
        {
            "DuplicateEmail" or "DuplicateUserName" => "Für diese E-Mail-Adresse besteht bereits ein Konto.",
            "PasswordTooShort" => "Das Passwort muss mindestens 10 Zeichen lang sein.",
            "PasswordRequiresDigit" => "Das Passwort muss mindestens eine Ziffer enthalten.",
            "PasswordRequiresLower" => "Das Passwort muss mindestens einen Kleinbuchstaben enthalten.",
            "PasswordRequiresUpper" => "Das Passwort muss mindestens einen Großbuchstaben enthalten.",
            "PasswordRequiresNonAlphanumeric" => "Das Passwort muss mindestens ein Sonderzeichen enthalten.",
            "InvalidEmail" => "Die E-Mail-Adresse ist ungültig.",
            _ => "Die Eingabe ist ungültig."
        }).Distinct().ToArray();
        return new RequestValidationException(new Dictionary<string, string[]> { ["password"] = messages });
    }
}

public static class EmailTemplates
{
    public static string Wrap(string heading, string bodyHtml, string? link, string? buttonText) => $"""
        <!doctype html><html lang="de"><body style="margin:0;background:#f5f5f4;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1c1917">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e7e5e4;border-radius:12px">
        <tr><td style="padding:28px 32px">
        <p style="margin:0 0 20px;font-weight:700;color:#0f766e;font-size:18px">GastroTeam</p>
        <h1 style="font-size:20px;margin:0 0 16px">{WebUtility.HtmlEncode(heading)}</h1>
        {bodyHtml}
        {(link is null ? "" : $"<p style=\"margin:24px 0\"><a href=\"{WebUtility.HtmlEncode(link)}\" style=\"background:#0f766e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600\">{WebUtility.HtmlEncode(buttonText ?? "Öffnen")}</a></p><p style=\"font-size:12px;color:#78716c;word-break:break-all\">Falls der Button nicht funktioniert: {WebUtility.HtmlEncode(link)}</p>")}
        </td></tr></table></td></tr></table></body></html>
        """;
}
