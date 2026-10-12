using System.Globalization;
using GastroTeam.Domain.Scheduling;

namespace GastroTeam.Application.Localization;

/// <summary>
/// German message catalogue for domain codes. Kept separate from business logic so further languages
/// can be added by introducing another catalogue keyed by the same codes.
/// </summary>
public static class Messages
{
    public static readonly CultureInfo German = CultureInfo.GetCultureInfo("de-DE");

    private static readonly Dictionary<string, string> De = new()
    {
        // Domain rule violations
        ["employee_archived"] = "Archivierte Mitarbeitende können nicht mehr geändert werden.",
        ["employee_must_be_inactive"] = "Nur inaktive Mitarbeitende können anonymisiert werden.",
        ["shift_cancelled"] = "Die Schicht wurde abgesagt und kann nicht mehr geändert werden.",
        ["leave_invalid_transition"] = "Der Antrag kann in seinem aktuellen Status nicht geändert werden.",
        ["leave_reason_required"] = "Bitte geben Sie einen Grund für die Ablehnung an.",
        ["swap_invalid_transition"] = "Die Tauschanfrage kann in ihrem aktuellen Status nicht geändert werden.",
        ["swap_self"] = "Sie können Ihre eigene Tauschanfrage nicht annehmen.",
        ["swap_not_target"] = "Diese Tauschanfrage ist an eine andere Person gerichtet.",
        ["swap_not_requester"] = "Nur die anfragende Person kann die Tauschanfrage zurückziehen.",
        ["plan_location_limit"] = "Ihr aktueller Tarif erlaubt keine weiteren Standorte.",
        ["plan_employee_limit"] = "Ihr aktueller Tarif erlaubt keine weiteren aktiven Mitarbeitenden.",
        ["plan_feature_missing"] = "Diese Funktion ist in Ihrem aktuellen Tarif nicht enthalten.",
        ["timezone_invalid"] = "Die Zeitzone ist ungültig.",
        ["time_in_dst_gap"] = "Diese Uhrzeit existiert wegen der Zeitumstellung an diesem Tag nicht.",

        // Schedule validation
        ["shift_invalid_interval"] = "Die Schicht hat einen ungültigen Zeitraum.",
        ["shift_too_long"] = "Die Schicht dauert {hours} Std. und überschreitet die maximale Schichtlänge von {max} Std.",
        ["break_too_short"] = "Die Pause ist kürzer als die empfohlenen {required} Minuten für diese Schichtlänge.",
        ["location_closed"] = "Der Standort ist an diesem Tag laut Öffnungszeiten geschlossen.",
        ["outside_opening_hours"] = "Die Schicht liegt außerhalb der Öffnungszeiten ({opens}–{closes} Uhr) inkl. Vor- und Nachbereitung.",
        ["shift_unassigned"] = "Schicht nicht besetzt.",
        ["employee_unknown"] = "Die zugewiesene Person ist unbekannt.",
        ["employee_inactive"] = "{name} ist nicht aktiv und kann nicht eingeplant werden.",
        ["employee_not_at_location"] = "{name} ist diesem Standort nicht zugeordnet.",
        ["employee_on_leave"] = "{name} hat an diesem Tag genehmigten Urlaub bzw. eine genehmigte Abwesenheit.",
        ["employee_leave_pending"] = "Für {name} liegt an diesem Tag ein offener Urlaubsantrag vor.",
        ["employee_unavailable"] = "{name} hat sich für diesen Zeitraum als nicht verfügbar gemeldet.",
        ["outside_availability"] = "Die Schicht liegt außerhalb der angegebenen Verfügbarkeit von {name}.",
        ["shift_overlap"] = "{name} hat überschneidende Schichten.",
        ["rest_period_short"] = "Ruhezeit für {name} beträgt nur {hours} Std. (konfiguriert: mindestens {min} Std.).",
        ["daily_hours_exceeded"] = "{name} ist an diesem Tag {hours} Std. eingeplant (konfiguriertes Maximum: {max} Std.).",
        ["weekly_hours_limit"] = "{name} ist in dieser Woche {hours} Std. eingeplant (konfiguriertes Maximum: {max} Std.).",
        ["weekly_target_exceeded"] = "{name} ist mit {hours} Std. über der vereinbarten Wochenarbeitszeit von {target} Std. eingeplant.",
        ["weekly_target_low"] = "{name} ist mit {hours} Std. deutlich unter der vereinbarten Wochenarbeitszeit von {target} Std. eingeplant.",
        ["coverage_below_minimum"] = "Nur {count} von mindestens {min} Personen eingeplant.",
    };

    public static string Get(string code, IReadOnlyDictionary<string, string>? args = null)
    {
        var template = De.TryGetValue(code, out var t) ? t : "Die Aktion konnte nicht ausgeführt werden.";
        if (args is null) return template;
        foreach (var (key, value) in args) template = template.Replace("{" + key + "}", value);
        return template;
    }

    public static bool Has(string code) => De.ContainsKey(code);

    public static string Describe(ScheduleIssue issue) => Get(issue.Code, issue.Args);

    public static string FormatDate(DateOnly d) => d.ToString("ddd, dd.MM.yyyy", German);

    public static string FormatHours(double h) => h.ToString("0.##", German);
}
