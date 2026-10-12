using GastroTeam.Domain.Common;

namespace GastroTeam.Domain.Scheduling;

/// <summary>Conversions between a location's local wall-clock time and UTC, including DST edge cases.</summary>
public static class ZonedTime
{
    public static TimeZoneInfo Find(string ianaId)
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(ianaId);
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            throw new DomainException("timezone_invalid", ianaId);
        }
    }

    public static bool IsValidZone(string ianaId)
    {
        try { Find(ianaId); return true; }
        catch (DomainException) { return false; }
    }

    /// <summary>
    /// Converts a local wall-clock time to UTC. Times inside the spring-forward gap do not exist and are rejected.
    /// Ambiguous times in the autumn fall-back hour are resolved to the earlier (daylight-saving) instant.
    /// </summary>
    public static DateTime ToUtc(DateOnly date, TimeOnly time, TimeZoneInfo zone)
    {
        var local = DateTime.SpecifyKind(date.ToDateTime(time), DateTimeKind.Unspecified);
        if (zone.IsInvalidTime(local)) throw new DomainException("time_in_dst_gap");
        if (zone.IsAmbiguousTime(local))
        {
            var offset = zone.GetAmbiguousTimeOffsets(local).Max();
            return DateTime.SpecifyKind(local - offset, DateTimeKind.Utc);
        }
        return TimeZoneInfo.ConvertTimeToUtc(local, zone);
    }

    public static DateTime ToLocal(DateTime utc, TimeZoneInfo zone) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), zone);

    /// <summary>
    /// Builds a UTC interval from a local date and start/end wall-clock times. An end time at or before
    /// the start time means the shift ends on the following day.
    /// </summary>
    public static (DateTime StartUtc, DateTime EndUtc) Interval(DateOnly date, TimeOnly start, TimeOnly end, TimeZoneInfo zone)
    {
        var startUtc = ToUtc(date, start, zone);
        var endDate = end <= start ? date.AddDays(1) : date;
        var endUtc = ToUtc(endDate, end, zone);
        return (startUtc, endUtc);
    }

    public static DateOnly WeekStart(DateOnly date)
    {
        var diff = ((int)date.DayOfWeek + 6) % 7; // Monday = 0
        return date.AddDays(-diff);
    }

    public static DateOnly Today(TimeZoneInfo zone, DateTime utcNow) => DateOnly.FromDateTime(ToLocal(utcNow, zone));
}
