using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.Text.Json;
using System.Text.Json.Serialization;
using FluentValidation;
using GastroTeam.Application.Common;
using GastroTeam.Application.Localization;
using GastroTeam.Domain.Common;
using GastroTeam.Infrastructure.Identity;
using GastroTeam.Infrastructure.Persistence;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;

namespace GastroTeam.Api.Infrastructure;

/// <summary>Accepts "HH:mm" and "HH:mm:ss", writes "HH:mm".</summary>
public sealed class TimeOnlyJsonConverter : JsonConverter<TimeOnly>
{
    public override TimeOnly Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        var s = reader.GetString();
        if (TimeOnly.TryParseExact(s, ["HH:mm", "HH:mm:ss", "H:mm"], CultureInfo.InvariantCulture, DateTimeStyles.None, out var t)) return t;
        throw new JsonException("Ungültige Uhrzeit.");
    }

    public override void Write(Utf8JsonWriter writer, TimeOnly value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value.ToString("HH:mm", CultureInfo.InvariantCulture));
}

public static class JsonSetup
{
    public static void Configure(JsonSerializerOptions o)
    {
        o.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        o.Converters.Add(new JsonStringEnumConverter());
        o.Converters.Add(new TimeOnlyJsonConverter());
        o.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
    }
}

/// <summary>Maps exceptions to RFC 7807 Problem Details. Internal details are never returned to clients.</summary>
public sealed class ProblemExceptionHandler(ILogger<ProblemExceptionHandler> logger, IHostEnvironment env) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext http, Exception exception, CancellationToken ct)
    {
        var problem = new ProblemDetails();
        switch (exception)
        {
            case RequestValidationException v:
                problem.Status = 400;
                problem.Title = v.Message;
                problem.Extensions["code"] = v.Code;
                problem.Extensions["errors"] = v.Errors.ToDictionary(k => JsonNamingPolicy.CamelCase.ConvertName(k.Key), k => k.Value);
                break;
            case AppException a:
                problem.Status = a.Status;
                problem.Title = a.Message;
                problem.Extensions["code"] = a.Code;
                if (a.Extensions is not null)
                    foreach (var p in a.Extensions.GetType().GetProperties())
                        problem.Extensions[JsonNamingPolicy.CamelCase.ConvertName(p.Name)] = p.GetValue(a.Extensions);
                break;
            case DomainException d:
                problem.Status = 422;
                problem.Title = Messages.Get(d.Code);
                problem.Extensions["code"] = d.Code;
                break;
            case DbUpdateConcurrencyException:
                problem.Status = 409;
                problem.Title = ConcurrencyErrors.Stale().Message;
                problem.Extensions["code"] = "concurrency_conflict";
                break;
            case BadHttpRequestException or JsonException:
                problem.Status = 400;
                problem.Title = "Die Anfrage ist ungültig.";
                problem.Extensions["code"] = "bad_request";
                break;
            case OperationCanceledException when http.RequestAborted.IsCancellationRequested:
                problem.Status = 499;
                problem.Title = "Abgebrochen";
                break;
            default:
                logger.LogError(exception, "Unhandled exception for {Method} {Path}", http.Request.Method, http.Request.Path);
                problem.Status = 500;
                problem.Title = "Es ist ein unerwarteter Fehler aufgetreten. Bitte versuchen Sie es später erneut.";
                problem.Extensions["code"] = "server_error";
                if (env.IsDevelopment()) problem.Detail = exception.Message;
                break;
        }
        problem.Extensions["traceId"] = http.TraceIdentifier;
        http.Response.StatusCode = problem.Status ?? 500;
        await http.Response.WriteAsJsonAsync(problem, (JsonSerializerOptions?)null, "application/problem+json", ct);
        return true;
    }
}

/// <summary>Runs FluentValidation validators for every action argument that has one.</summary>
public sealed class ValidationFilter(IServiceProvider services) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        foreach (var arg in context.ActionArguments.Values)
        {
            if (arg is null) continue;
            var validatorType = typeof(IValidator<>).MakeGenericType(arg.GetType());
            if (services.GetService(validatorType) is not IValidator validator) continue;
            var result = await validator.ValidateAsync(new ValidationContext<object>(arg), context.HttpContext.RequestAborted);
            if (!result.IsValid)
                throw new RequestValidationException(result.Errors
                    .GroupBy(e => string.IsNullOrEmpty(e.PropertyName) ? "request" : e.PropertyName)
                    .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorMessage).Distinct().ToArray()));
        }
        await next();
    }
}

/// <summary>
/// Builds the request context: verifies the user still exists and the token's security stamp is current,
/// then resolves tenant membership from the database. Client-supplied tenant ids are only a selection hint.
/// </summary>
public sealed class TenantContextMiddleware(RequestDelegate next)
{
    public const string TenantHeader = "X-Tenant-Id";

    public async Task InvokeAsync(HttpContext http, RequestContext ctx, TenantResolver resolver, AppDbContext db)
    {
        ctx.IpAddress = http.Connection.RemoteIpAddress?.ToString();
        ctx.UserAgent = http.Request.Headers.UserAgent.ToString();

        if (http.User.Identity?.IsAuthenticated == true &&
            Guid.TryParse(http.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value, out var userId))
        {
            var user = await db.Users.Where(u => u.Id == userId)
                .Select(u => new { u.Email, u.IsPlatformAdmin, u.IsDeleted, u.SecurityStamp, u.LockoutEnd })
                .SingleOrDefaultAsync(http.RequestAborted);
            var stamp = http.User.FindFirst("sst")?.Value;
            if (user is null || user.IsDeleted || stamp != TokenService.StampHash(user.SecurityStamp))
            {
                // Stale token (password changed, account deleted): continue as anonymous so that
                // [Authorize] endpoints answer 401 while login and other public endpoints keep working.
                http.User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity());
                await next(http);
                return;
            }

            ctx.UserId = userId;
            ctx.Email = user.Email;
            ctx.IsPlatformAdmin = user.IsPlatformAdmin;

            Guid? requested = null;
            if (http.Request.Headers.TryGetValue(TenantHeader, out var raw) && !string.IsNullOrWhiteSpace(raw))
            {
                if (!Guid.TryParse(raw, out var parsed))
                {
                    await Reject(http, 400, "invalid_tenant", "Ungültige Restaurant-Kennung.");
                    return;
                }
                requested = parsed;
            }
            if (!await resolver.ResolveAsync(userId, requested, http.RequestAborted))
            {
                await Reject(http, 403, "tenant_forbidden", "Sie haben keinen Zugriff auf dieses Restaurant.");
                return;
            }
        }
        await next(http);
    }

    private static Task Reject(HttpContext http, int status, string code, string title)
    {
        http.Response.StatusCode = status;
        return http.Response.WriteAsJsonAsync(new { status, title, code, traceId = http.TraceIdentifier }, (JsonSerializerOptions?)null, "application/problem+json");
    }
}

public sealed class SecurityHeadersMiddleware(RequestDelegate next)
{
    public Task InvokeAsync(HttpContext http)
    {
        var h = http.Response.Headers;
        h["X-Content-Type-Options"] = "nosniff";
        h["X-Frame-Options"] = "DENY";
        h["Referrer-Policy"] = "no-referrer";
        h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
        h["Cross-Origin-Opener-Policy"] = "same-origin";
        if (!http.Request.Path.StartsWithSegments("/swagger"))
            h["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'";
        return next(http);
    }
}
