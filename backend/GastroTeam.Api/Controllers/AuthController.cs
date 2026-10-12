using GastroTeam.Application.Common;
using GastroTeam.Application.Features.Account;
using GastroTeam.Application.Features.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace GastroTeam.Api.Controllers;

public sealed class CookieSettings
{
    public const string Section = "Auth:Cookie";
    public string Name { get; set; } = "gt_refresh";
    /// <summary>"None" when web app and API are on different sites (e.g. GitHub Pages + API host), else "Lax".</summary>
    public string SameSite { get; set; } = "Lax";
    public bool Secure { get; set; } = true;
}

/// <summary>Response body for logins. The refresh token is only included for native clients.</summary>
public sealed record TokenResponse(string AccessToken, DateTime AccessTokenExpiresAt, string? RefreshToken, DateTime RefreshTokenExpiresAt);
public sealed record RefreshRequest(string? RefreshToken);

[ApiController]
[Route("api/v1/auth")]
public sealed class AuthController(AuthService auth, AccountService account, IConfiguration config) : ControllerBase
{
    private const string ClientHeader = "X-Client";
    private const string CsrfHeader = "X-Requested-With";

    private bool IsNativeClient => Request.Headers[ClientHeader] == "mobile";

    [HttpPost("register"), AllowAnonymous, EnableRateLimiting("auth")]
    public async Task<ActionResult<object>> Register(RegisterRequest req, CancellationToken ct)
    {
        var result = await auth.RegisterAsync(req, ct);
        if (result.Tokens is null) return StatusCode(201, new { requiresEmailVerification = true });
        return StatusCode(201, new { requiresEmailVerification = false, tokens = Issue(result.Tokens) });
    }

    [HttpPost("login"), AllowAnonymous, EnableRateLimiting("auth")]
    public async Task<TokenResponse> Login(LoginRequest req, CancellationToken ct) => Issue(await auth.LoginAsync(req, ct));

    /// <summary>Rotates the refresh token. Web: HttpOnly cookie + anti-CSRF header. Native: token in body.</summary>
    [HttpPost("refresh"), AllowAnonymous, EnableRateLimiting("refresh")]
    public async Task<TokenResponse> Refresh([FromBody] RefreshRequest? req, CancellationToken ct)
    {
        string? raw;
        if (IsNativeClient) raw = req?.RefreshToken;
        else
        {
            RequireCsrfHeader();
            raw = Request.Cookies[Cookie.Name];
        }
        if (string.IsNullOrEmpty(raw))
            throw new UnauthorizedException("invalid_session", "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.");
        try
        {
            return Issue(await auth.RefreshAsync(raw, ct));
        }
        catch (UnauthorizedException)
        {
            if (!IsNativeClient) ClearCookie();
            throw;
        }
    }

    [HttpPost("logout"), AllowAnonymous]
    public async Task<IActionResult> Logout([FromBody] RefreshRequest? req, CancellationToken ct)
    {
        if (IsNativeClient) await auth.LogoutAsync(req?.RefreshToken, ct);
        else
        {
            RequireCsrfHeader();
            await auth.LogoutAsync(Request.Cookies[Cookie.Name], ct);
            ClearCookie();
        }
        return NoContent();
    }

    [HttpPost("verify-email"), AllowAnonymous, EnableRateLimiting("auth")]
    public async Task<IActionResult> VerifyEmail(VerifyEmailRequest req, CancellationToken ct)
    {
        await auth.VerifyEmailAsync(req, ct);
        return NoContent();
    }

    [HttpPost("resend-verification"), AllowAnonymous, EnableRateLimiting("auth")]
    public async Task<IActionResult> ResendVerification(ResendVerificationRequest req, CancellationToken ct)
    {
        await auth.ResendVerificationAsync(req.Email, ct);
        return Accepted();
    }

    [HttpPost("forgot-password"), AllowAnonymous, EnableRateLimiting("auth")]
    public async Task<IActionResult> ForgotPassword(ForgotPasswordRequest req, CancellationToken ct)
    {
        await auth.ForgotPasswordAsync(req.Email, ct);
        return Accepted();
    }

    [HttpPost("reset-password"), AllowAnonymous, EnableRateLimiting("auth")]
    public async Task<IActionResult> ResetPassword(ResetPasswordRequest req, CancellationToken ct)
    {
        await auth.ResetPasswordAsync(req, ct);
        return NoContent();
    }

    [HttpPost("change-password"), Authorize, EnableRateLimiting("auth")]
    public async Task<IActionResult> ChangePassword(ChangePasswordRequest req, CancellationToken ct)
    {
        await auth.ChangePasswordAsync(req, ct);
        if (!IsNativeClient) ClearCookie();
        return NoContent();
    }

    [HttpGet("me"), Authorize]
    public Task<MeDto> Me(CancellationToken ct) => account.GetMeAsync(ct);

    private CookieSettings Cookie => config.GetSection(CookieSettings.Section).Get<CookieSettings>() ?? new CookieSettings();

    private TokenResponse Issue(AuthTokens t)
    {
        if (IsNativeClient) return new TokenResponse(t.AccessToken, t.AccessTokenExpiresAt, t.RefreshToken, t.RefreshTokenExpiresAt);
        Response.Cookies.Append(Cookie.Name, t.RefreshToken, CookieOptions(t.RefreshTokenExpiresAt));
        return new TokenResponse(t.AccessToken, t.AccessTokenExpiresAt, null, t.RefreshTokenExpiresAt);
    }

    private void ClearCookie() => Response.Cookies.Delete(Cookie.Name, CookieOptions(DateTime.UnixEpoch));

    private CookieOptions CookieOptions(DateTime expires)
    {
        var c = Cookie;
        var sameSite = Enum.TryParse<SameSiteMode>(c.SameSite, true, out var s) ? s : SameSiteMode.Lax;
        var options = new CookieOptions
        {
            HttpOnly = true,
            Secure = c.Secure || sameSite == SameSiteMode.None,
            SameSite = sameSite,
            Path = "/api/v1/auth",
            Expires = expires,
            IsEssential = true
        };
        // CHIPS: lets the cross-site cookie work in browsers that partition third-party cookies.
        if (sameSite == SameSiteMode.None) options.Extensions.Add("Partitioned");
        return options;
    }

    /// <summary>A custom header forces a CORS preflight, so only allow-listed origins can trigger cookie-based calls.</summary>
    private void RequireCsrfHeader()
    {
        if (Request.Headers[CsrfHeader] != "GastroTeam")
            throw new ForbiddenException("Ungültige Anfrage.");
    }
}
