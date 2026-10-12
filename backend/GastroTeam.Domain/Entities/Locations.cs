using GastroTeam.Domain.Common;

namespace GastroTeam.Domain.Entities;

public class RestaurantLocation : Entity, ITenantOwned
{
    public Guid TenantId { get; set; }
    public string Name { get; set; } = "";
    public string? Street { get; set; }
    public string? PostalCode { get; set; }
    public string? City { get; set; }
    public string Country { get; set; } = "DE";
    /// <summary>IANA time zone, e.g. "Europe/Berlin". All shift times are interpreted in this zone.</summary>
    public string TimeZoneId { get; set; } = "Europe/Berlin";
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public bool IsActive { get; set; } = true;
    /// <summary>Minimum number of assigned shifts per opening day; 0 disables the coverage check.</summary>
    public int MinStaffPerDay { get; set; }
    public int DefaultBreakMinutes { get; set; } = 30;
    /// <summary>Minutes before opening / after closing in which shifts are still considered normal.</summary>
    public int PrepBufferMinutes { get; set; } = 120;

    public List<LocationOpeningHour> OpeningHours { get; set; } = [];
}

public class LocationOpeningHour : ITenantOwned
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid TenantId { get; set; }
    public Guid LocationId { get; set; }
    public DayOfWeek DayOfWeek { get; set; }
    public bool IsClosed { get; set; }
    public TimeOnly OpensAt { get; set; }
    /// <summary>A closing time at or before <see cref="OpensAt"/> means the location closes after midnight.</summary>
    public TimeOnly ClosesAt { get; set; }
}

/// <summary>Configurable job role or station (Service, Küche, Bar, ...).</summary>
public class JobRole : Entity, ITenantOwned
{
    public Guid TenantId { get; set; }
    public string Name { get; set; } = "";
    /// <summary>Hex colour used as an accent in the schedule; never the only carrier of meaning.</summary>
    public string Color { get; set; } = "#0F766E";
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}
