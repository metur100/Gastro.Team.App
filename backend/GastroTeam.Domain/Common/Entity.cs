namespace GastroTeam.Domain.Common;

public abstract class Entity
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>Marks an entity that belongs to exactly one tenant (restaurant business).</summary>
public interface ITenantOwned
{
    Guid TenantId { get; set; }
}

/// <summary>Marks an entity that uses a SQL Server rowversion for optimistic concurrency.</summary>
public interface IVersioned
{
    byte[] RowVersion { get; set; }
}

/// <summary>Raised when a business rule is violated. Code is a stable machine-readable identifier.</summary>
public class DomainException(string code, string? detail = null) : Exception(detail ?? code)
{
    public string Code { get; } = code;
}
