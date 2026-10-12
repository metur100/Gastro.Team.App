namespace GastroTeam.Application.Common;

/// <summary>Base for expected, client-facing errors. Message is German and safe to show to users.</summary>
public abstract class AppException(int status, string code, string message) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public object? Extensions { get; init; }
}

public sealed class NotFoundException(string message = "Der Eintrag wurde nicht gefunden.")
    : AppException(404, "not_found", message);

public sealed class ForbiddenException(string message = "Sie haben keine Berechtigung für diese Aktion.")
    : AppException(403, "forbidden", message);

public sealed class UnauthorizedException(string code, string message) : AppException(401, code, message);

public sealed class ConflictException(string code, string message) : AppException(409, code, message);

/// <summary>A business rule rejected the request (HTTP 422).</summary>
public sealed class BusinessRuleException(string code, string message) : AppException(422, code, message);

public sealed class RequestValidationException(IDictionary<string, string[]> errors)
    : AppException(400, "validation_failed", "Bitte prüfen Sie Ihre Eingaben.")
{
    public IDictionary<string, string[]> Errors { get; } = errors;

    public static RequestValidationException For(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });
}

public static class ConcurrencyErrors
{
    public static ConflictException Stale(string what = "Der Eintrag") =>
        new("concurrency_conflict",
            $"{what} wurde zwischenzeitlich von einer anderen Person geändert. Bitte laden Sie die Ansicht neu und versuchen Sie es erneut.");
}
