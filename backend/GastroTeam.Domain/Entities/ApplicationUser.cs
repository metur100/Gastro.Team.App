using Microsoft.AspNetCore.Identity;

namespace GastroTeam.Domain.Entities;

/// <summary>
/// Login identity. Deliberately separate from <see cref="Employee"/>: one login can be a member
/// of several tenants and be linked to an employee record in each of them.
/// </summary>
public class ApplicationUser : IdentityUser<Guid>
{
    public string FirstName { get; set; } = "";
    public string LastName { get; set; } = "";
    public string PreferredLanguage { get; set; } = "de-DE";
    public bool IsPlatformAdmin { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? LastLoginAt { get; set; }

    public string FullName => $"{FirstName} {LastName}".Trim();
}

public class RefreshToken
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid UserId { get; set; }
    /// <summary>SHA-256 hash of the opaque token; the token itself is never stored.</summary>
    public string TokenHash { get; set; } = "";
    /// <summary>All tokens issued from one login share a family; reuse of a rotated token revokes the family.</summary>
    public Guid FamilyId { get; set; }
    public DateTime FamilyCreatedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public string? RevokedReason { get; set; }
    public Guid? ReplacedByTokenId { get; set; }
    public string? CreatedByIp { get; set; }
    public string? UserAgent { get; set; }

    public bool IsActive(DateTime now) => RevokedAt is null && ExpiresAt > now;
}
