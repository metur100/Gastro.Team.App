using GastroTeam.Application.Features.Auth;

namespace GastroTeam.Api.Infrastructure;

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

/// <summary>
/// Delivers refresh tokens: browsers get an HttpOnly cookie (never readable by JS),
/// native clients (header X-Client: mobile) get the token in the body for secure device storage.
/// </summary>
public sealed class RefreshCookie(IConfiguration config)
{
    public const string ClientHeader = "X-Client";

    public static bool IsNativeClient(HttpRequest request) => request.Headers[ClientHeader] == "mobile";

    public CookieSettings Settings => config.GetSection(CookieSettings.Section).Get<CookieSettings>() ?? new CookieSettings();

    public TokenResponse Issue(HttpContext http, AuthTokens t)
    {
        if (IsNativeClient(http.Request)) return new TokenResponse(t.AccessToken, t.AccessTokenExpiresAt, t.RefreshToken, t.RefreshTokenExpiresAt);
        http.Response.Cookies.Append(Settings.Name, t.RefreshToken, Options(t.RefreshTokenExpiresAt));
        return new TokenResponse(t.AccessToken, t.AccessTokenExpiresAt, null, t.RefreshTokenExpiresAt);
    }

    public string? Read(HttpRequest request) => request.Cookies[Settings.Name];

    public void Clear(HttpContext http) => http.Response.Cookies.Delete(Settings.Name, Options(DateTime.UnixEpoch));

    private CookieOptions Options(DateTime expires)
    {
        var c = Settings;
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
}
