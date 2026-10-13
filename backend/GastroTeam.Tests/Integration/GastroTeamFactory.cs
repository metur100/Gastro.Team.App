using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using GastroTeam.Api.Infrastructure;
using GastroTeam.Infrastructure.Messaging;
using GastroTeam.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace GastroTeam.Tests.Integration;

/// <summary>
/// Hosts the API against a real, uniquely named SQL Server database (LocalDB by default, or the server in
/// GT_TEST_SQL). The database is created via migrations and dropped when the fixture is disposed.
/// </summary>
public class GastroTeamFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly string _database = $"GastroTeam_Test_{Guid.NewGuid():N}";

    public string ConnectionString { get; }
    protected virtual string EnvironmentName => "Testing";
    protected virtual bool RequireEmailVerification => true;

    public GastroTeamFactory()
    {
        var baseCs = Environment.GetEnvironmentVariable("GT_TEST_SQL")
                     ?? @"Server=(localdb)\MSSQLLocalDB;Trusted_Connection=True;TrustServerCertificate=True";
        ConnectionString = new SqlConnectionStringBuilder(baseCs) { InitialCatalog = _database }.ConnectionString;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(EnvironmentName);
        // UseSetting applies before Program.cs reads configuration eagerly (minimal hosting).
        foreach (var (key, value) in new Dictionary<string, string?>
        {
            ["ConnectionStrings:Default"] = ConnectionString,
            ["Jwt:SigningKey"] = "integration-test-signing-key-0123456789-abcdefghijkl",
            ["Email:UseDevMailbox"] = "true",
            ["App:RequireEmailVerification"] = RequireEmailVerification ? "true" : "false",
            ["App:AllowManualPlanChange"] = "true",
            ["App:WebBaseUrl"] = "http://web.test",
            ["RateLimiting:AuthPermitPerMinute"] = "10000",
            ["RateLimiting:GlobalPermitPerMinute"] = "100000",
            ["Outbox:Enabled"] = "false",
            ["Auth:Cookie:Secure"] = "false",
            ["Auth:Cookie:SameSite"] = "Lax",
            ["Cors:AllowedOrigins:0"] = "http://web.test",
        })
            builder.UseSetting(key, value);
    }

    public async Task InitializeAsync()
    {
        using var scope = Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
    }

    public new async Task DisposeAsync()
    {
        using (var scope = Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.EnsureDeletedAsync();
        await base.DisposeAsync();
    }

    public DevMailbox Mailbox => Services.GetRequiredService<DevMailbox>();

    /// <summary>Runs code with a fresh DbContext that bypasses no filters unless the caller uses IgnoreQueryFilters().</summary>
    public async Task WithDbAsync(Func<AppDbContext, Task> action)
    {
        using var scope = Services.CreateScope();
        await action(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }

    public ApiClient Client() => new(CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false, BaseAddress = new Uri("http://localhost") }), this);
}

/// <summary>Variant without mandatory e-mail verification (faster setup for most scenarios).</summary>
public sealed class OpenRegistrationFactory : GastroTeamFactory
{
    protected override bool RequireEmailVerification => false;
}

public sealed class ProductionLikeFactory : GastroTeamFactory
{
    protected override string EnvironmentName => "Production";
}

public sealed class ApiException(HttpStatusCode status, string body) : Exception($"{(int)status}: {body}")
{
    public HttpStatusCode Status { get; } = status;
    public string Body { get; } = body;
    public string? Code => JsonDocument.Parse(Body).RootElement.TryGetProperty("code", out var c) ? c.GetString() : null;
}

/// <summary>Thin typed HTTP client acting as the native client (tokens in the body).</summary>
public sealed class ApiClient(HttpClient http, GastroTeamFactory factory)
{
    public static readonly JsonSerializerOptions Json = CreateJson();

    private static JsonSerializerOptions CreateJson()
    {
        var o = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        o.Converters.Add(new JsonStringEnumConverter());
        o.Converters.Add(new TimeOnlyJsonConverter());
        return o;
    }

    public HttpClient Http => http;
    public GastroTeamFactory Factory => factory;
    public string? AccessToken { get; private set; }
    public string? RefreshToken { get; private set; }
    public Guid? TenantId { get; set; }

    public void UseToken(string? token) => AccessToken = token;

    public async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, object? body = null)
    {
        var req = new HttpRequestMessage(method, "/api/v1" + path);
        req.Headers.Add("X-Client", "mobile");
        if (AccessToken is not null) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AccessToken);
        if (TenantId is not null) req.Headers.Add("X-Tenant-Id", TenantId.ToString());
        if (body is not null) req.Content = JsonContent.Create(body, body.GetType(), options: Json);
        return await http.SendAsync(req);
    }

    public async Task<T> SendAsync<T>(HttpMethod method, string path, object? body = null)
    {
        var res = await SendAsync(method, path, body);
        var text = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode) throw new ApiException(res.StatusCode, text);
        return JsonSerializer.Deserialize<T>(text, Json)!;
    }

    public Task<T> GetAsync<T>(string path) => SendAsync<T>(HttpMethod.Get, path);
    public Task<T> PostAsync<T>(string path, object? body = null) => SendAsync<T>(HttpMethod.Post, path, body ?? new { });
    public Task<T> PutAsync<T>(string path, object body) => SendAsync<T>(HttpMethod.Put, path, body);

    public async Task<HttpResponseMessage> PostRawAsync(string path, object? body = null) => await SendAsync(HttpMethod.Post, path, body ?? new { });

    /// <summary>Asserts the call fails with the status (and optional problem code) and returns the exception.</summary>
    public async Task<ApiException> ExpectFailureAsync(HttpMethod method, string path, HttpStatusCode status, string? code = null, object? body = null)
    {
        var res = await SendAsync(method, path, body ?? (method == HttpMethod.Get || method == HttpMethod.Delete ? null : new { }));
        var text = await res.Content.ReadAsStringAsync();
        Assert.True(res.StatusCode == status, $"Expected {(int)status} for {method} {path} but got {(int)res.StatusCode}: {text}");
        var ex = new ApiException(res.StatusCode, text);
        if (code is not null) Assert.Equal(code, ex.Code);
        return ex;
    }

    public async Task LoginAsync(string email, string password)
    {
        var tokens = await PostAsync<TokenDto>("/auth/login", new { email, password });
        AccessToken = tokens.AccessToken;
        RefreshToken = tokens.RefreshToken;
    }

    public async Task<TokenDto> RefreshAsync(string? token = null)
    {
        var tokens = await PostAsync<TokenDto>("/auth/refresh", new { refreshToken = token ?? RefreshToken });
        AccessToken = tokens.AccessToken;
        RefreshToken = tokens.RefreshToken;
        return tokens;
    }
}

public sealed record TokenDto(string AccessToken, DateTime AccessTokenExpiresAt, string? RefreshToken, DateTime RefreshTokenExpiresAt);
