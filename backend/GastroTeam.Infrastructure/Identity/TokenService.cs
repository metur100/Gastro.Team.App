using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using GastroTeam.Application.Common;
using GastroTeam.Domain.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace GastroTeam.Infrastructure.Identity;

public sealed class JwtOptions
{
    public const string Section = "Jwt";
    public string Issuer { get; set; } = "gastroteam-api";
    public string Audience { get; set; } = "gastroteam-clients";
    /// <summary>HMAC key, at least 32 bytes. Must come from a secret store / environment variable.</summary>
    public string SigningKey { get; set; } = "";
    public int AccessTokenMinutes { get; set; } = 15;

    public SymmetricSecurityKey Key()
    {
        if (Encoding.UTF8.GetByteCount(SigningKey) < 32)
            throw new InvalidOperationException("Jwt:SigningKey must be configured with at least 32 bytes.");
        return new SymmetricSecurityKey(Encoding.UTF8.GetBytes(SigningKey));
    }
}

public sealed class TokenService(IOptions<JwtOptions> options, IClock clock) : ITokenService
{
    private readonly JwtOptions _opt = options.Value;

    public (string Token, DateTime ExpiresAt) CreateAccessToken(ApplicationUser user)
    {
        var now = clock.UtcNow;
        var expires = now.AddMinutes(_opt.AccessTokenMinutes);
        // Only identity claims. Roles and tenant permissions are resolved from the database per request.
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(JwtRegisteredClaimNames.Email, user.Email ?? ""),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("N")),
            new Claim("sst", StampHash(user.SecurityStamp))
        };
        var token = new JwtSecurityToken(_opt.Issuer, _opt.Audience, claims, now, expires,
            new SigningCredentials(_opt.Key(), SecurityAlgorithms.HmacSha256));
        return (new JwtSecurityTokenHandler().WriteToken(token), expires);
    }

    /// <summary>Short hash of the security stamp; a password change invalidates outstanding access tokens.</summary>
    public static string StampHash(string? stamp) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(stamp ?? "")))[..16];

    public string GenerateOpaqueToken() => WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));

    public string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}

/// <summary>E-mail confirmation tokens get a longer lifetime than password-reset tokens.</summary>
public sealed class EmailConfirmationTokenProvider<TUser>(
    Microsoft.AspNetCore.DataProtection.IDataProtectionProvider dataProtectionProvider,
    IOptions<EmailConfirmationTokenProviderOptions> options,
    ILogger<DataProtectorTokenProvider<TUser>> logger)
    : DataProtectorTokenProvider<TUser>(dataProtectionProvider, options, logger) where TUser : class;

public sealed class EmailConfirmationTokenProviderOptions : DataProtectionTokenProviderOptions
{
    public EmailConfirmationTokenProviderOptions()
    {
        Name = "EmailConfirmationProvider";
        TokenLifespan = TimeSpan.FromDays(3);
    }
}
