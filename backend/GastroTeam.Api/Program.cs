using System.Threading.RateLimiting;
using GastroTeam.Api.Controllers;
using GastroTeam.Api.Infrastructure;
using GastroTeam.Application;
using GastroTeam.Infrastructure;
using GastroTeam.Infrastructure.Identity;
using GastroTeam.Infrastructure.Persistence;
using GastroTeam.Infrastructure.Seeding;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((ctx, services, cfg) => cfg
    .ReadFrom.Configuration(ctx.Configuration)
    .Enrich.FromLogContext()
    .WriteTo.Console());

builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration, builder.Environment);

builder.Services
    .AddControllers(o => o.Filters.Add<ValidationFilter>())
    .ConfigureApplicationPartManager(m =>
    {
        // Development helpers do not exist in Production builds of the route table.
        if (builder.Environment.IsProduction()) m.FeatureProviders.Add(new ExcludeControllerFeatureProvider(typeof(DevController)));
    })
    .ConfigureApiBehaviorOptions(o => o.SuppressModelStateInvalidFilter = false)
    .AddJsonOptions(o => JsonSetup.Configure(o.JsonSerializerOptions));
builder.Services.ConfigureHttpJsonOptions(o => JsonSetup.Configure(o.SerializerOptions));
builder.Services.AddScoped<RefreshCookie>();
builder.Services.AddExceptionHandler<ProblemExceptionHandler>();
builder.Services.AddProblemDetails();
builder.Services.AddOpenApi("v1");

var jwt = builder.Configuration.GetSection(JwtOptions.Section).Get<JwtOptions>() ?? new JwtOptions();
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
{
    o.MapInboundClaims = false;
    o.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidIssuer = jwt.Issuer,
        ValidateAudience = true,
        ValidAudience = jwt.Audience,
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = jwt.Key(),
        ValidateLifetime = true,
        ClockSkew = TimeSpan.FromSeconds(30),
        NameClaimType = "sub"
    };
});
builder.Services.AddAuthorization();

var origins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(origins)
    .AllowAnyHeader()
    .WithMethods("GET", "POST", "PUT", "DELETE")
    .AllowCredentials()
    .WithExposedHeaders("Content-Disposition")
    .SetPreflightMaxAge(TimeSpan.FromMinutes(10))));

var authPermit = builder.Configuration.GetValue("RateLimiting:AuthPermitPerMinute", 10);
var globalPermit = builder.Configuration.GetValue("RateLimiting:GlobalPermitPerMinute", 600);
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.OnRejected = async (ctx, ct) =>
    {
        ctx.HttpContext.Response.ContentType = "application/problem+json";
        await ctx.HttpContext.Response.WriteAsJsonAsync(new
        {
            status = 429, code = "rate_limited", title = "Zu viele Anfragen. Bitte warten Sie einen Moment und versuchen Sie es erneut."
        }, ct);
    };
    o.AddPolicy("auth", http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = authPermit, Window = TimeSpan.FromMinutes(1) }));
    o.AddPolicy("refresh", http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = authPermit * 6, Window = TimeSpan.FromMinutes(1) }));
    o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(http => RateLimitPartition.GetFixedWindowLimiter(
        http.User.FindFirst("sub")?.Value ?? http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = globalPermit, Window = TimeSpan.FromMinutes(1) }));
});

builder.Services.AddHsts(o => o.MaxAge = TimeSpan.FromDays(365));

var app = builder.Build();

// ---------- Command-line maintenance tasks (explicit, never automatic) ----------
if (args.Length > 0 && args[0] is "migrate" or "seed-demo")
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    if (args[0] == "migrate")
    {
        await db.Database.MigrateAsync();
        Console.WriteLine("Migrations applied.");
    }
    else
    {
        if (app.Environment.IsProduction() && !args.Contains("--allow-production"))
        {
            Console.Error.WriteLine("Refusing to seed demo data in Production. Pass --allow-production only for an isolated demo database.");
            return 1;
        }
        var pwIndex = Array.IndexOf(args, "--password");
        var password = pwIndex > 0 && pwIndex + 1 < args.Length ? args[pwIndex + 1] : Environment.GetEnvironmentVariable("DEMO_PASSWORD");
        if (string.IsNullOrWhiteSpace(password) || password.Length < 10)
        {
            Console.Error.WriteLine("Provide a demo password (>= 10 chars) via --password or DEMO_PASSWORD.");
            return 1;
        }
        var result = await scope.ServiceProvider.GetRequiredService<DemoSeeder>().SeedAsync(password);
        Console.WriteLine(result.Created ? "Demo data created." : "Demo data already present.");
        Console.WriteLine("Logins: " + string.Join(", ", result.Logins));
    }
    return 0;
}

app.UseExceptionHandler();
if (!app.Environment.IsDevelopment()) app.UseHsts();
app.UseMiddleware<SecurityHeadersMiddleware>();
app.UseSerilogRequestLogging(o => o.GetLevel = (http, _, ex) =>
    ex is not null || http.Response.StatusCode >= 500 ? Serilog.Events.LogEventLevel.Error : Serilog.Events.LogEventLevel.Information);
app.UseHttpsRedirection();
app.UseCors();
app.UseAuthentication();
app.UseMiddleware<TenantContextMiddleware>();
app.UseRateLimiter();
app.UseAuthorization();

if (app.Environment.IsDevelopment() || app.Configuration.GetValue("Swagger:Enabled", false))
{
    app.MapOpenApi("/openapi/{documentName}.json");
    app.UseSwaggerUI(o =>
    {
        o.SwaggerEndpoint("/openapi/v1.json", "GastroTeam API v1");
        o.DocumentTitle = "GastroTeam API";
    });
}

app.MapGet("/", () => Results.Ok(new { name = "GastroTeam API", docs = "/swagger", health = "/health" })).AllowAnonymous();
app.MapControllers();

app.Run();
return 0;

/// <summary>Removes a controller from the application parts (used to drop dev endpoints in Production).</summary>
internal sealed class ExcludeControllerFeatureProvider(Type excluded) : IApplicationFeatureProvider<ControllerFeature>
{
    public void PopulateFeature(IEnumerable<ApplicationPart> parts, ControllerFeature feature)
    {
        var match = feature.Controllers.FirstOrDefault(c => c.AsType() == excluded);
        if (match is not null) feature.Controllers.Remove(match);
    }
}

public partial class Program;
