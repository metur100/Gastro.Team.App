using GastroTeam.Api.Infrastructure;
using GastroTeam.Application.Common;
using GastroTeam.Application.Features.Account;
using GastroTeam.Application.Features.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace GastroTeam.Api.Controllers;

public sealed record RefreshRequest(string? RefreshToken);

[ApiController]
[Route("api/v1/auth")]
public sealed class AuthController(AuthService auth, AccountService account, RefreshCookie cookie) : ControllerBase
{
    private const string CsrfHeader = "X-Requested-With";

    private bool IsNativeClient => RefreshCookie.IsNativeClient(Request);

    [HttpPost("register"), AllowAnonymous, EnableRateLimiting("auth")]
    public async Task<ActionResult<object>> Register(RegisterRequest req, CancellationToken ct)
    {
        var result = await auth.RegisterAsync(req, ct);
        if (result.Tokens is null) return StatusCode(201, new { requiresEmailVerification = true });
        return StatusCode(201, new { requiresEmailVerification = false, tokens = cookie.Issue(HttpContext, result.Tokens) });
    }

    [HttpPost("login"), AllowAnonymous, EnableRateLimiting("auth")]
    public async Task<TokenResponse> Login(LoginRequest req, CancellationToken ct) => cookie.Issue(HttpContext, await auth.LoginAsync(req, ct));

    /// <summary>Rotates the refresh token. Web: HttpOnly cookie + anti-CSRF header. Native: token in body.</summary>
    [HttpPost("refresh"), AllowAnonymous, EnableRateLimiting("refresh")]
    public async Task<TokenResponse> Refresh([FromBody] RefreshRequest? req, CancellationToken ct)
    {
        string? raw;
        if (IsNativeClient) raw = req?.RefreshToken;
        else
        {
            RequireCsrfHeader();
            raw = cookie.Read(Request);
        }
        if (string.IsNullOrEmpty(raw))
            throw new UnauthorizedException("invalid_session", "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.");
        try
        {
            return cookie.Issue(HttpContext, await auth.RefreshAsync(raw, ct));
        }
        catch (UnauthorizedException)
        {
            if (!IsNativeClient) cookie.Clear(HttpContext);
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
            await auth.LogoutAsync(cookie.Read(Request), ct);
            cookie.Clear(HttpContext);
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
        if (!IsNativeClient) cookie.Clear(HttpContext);
        return NoContent();
    }

    [HttpGet("me"), Authorize]
    public Task<MeDto> Me(CancellationToken ct) => account.GetMeAsync(ct);

    /// <summary>A custom header forces a CORS preflight, so only allow-listed origins can trigger cookie-based calls.</summary>
    private void RequireCsrfHeader()
    {
        if (Request.Headers[CsrfHeader] != "GastroTeam")
            throw new ForbiddenException("Ungültige Anfrage.");
    }
}
