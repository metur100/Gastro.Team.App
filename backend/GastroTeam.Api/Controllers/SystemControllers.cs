using GastroTeam.Infrastructure.Messaging;
using GastroTeam.Infrastructure.Persistence;
using GastroTeam.Infrastructure.Seeding;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace GastroTeam.Api.Controllers;

[ApiController, AllowAnonymous]
public sealed class HealthController(AppDbContext db) : ControllerBase
{
    [HttpGet("/health")]
    public async Task<IActionResult> Health(CancellationToken ct)
    {
        bool dbOk;
        try { dbOk = await db.Database.CanConnectAsync(ct); }
        catch { dbOk = false; }
        var body = new { status = dbOk ? "ok" : "degraded", database = dbOk ? "ok" : "unreachable", version = typeof(HealthController).Assembly.GetName().Version?.ToString() };
        return dbOk ? Ok(body) : StatusCode(503, body);
    }
}

/// <summary>
/// Development/testing helpers. The controller is removed from the application in Production
/// (see Program.cs) and additionally refuses to run there.
/// </summary>
[ApiController, AllowAnonymous]
[Route("api/v1/dev")]
public sealed class DevController(IWebHostEnvironment env, IServiceProvider services) : ControllerBase
{
    public sealed record SeedRequest(string Password);

    [HttpPost("seed")]
    public async Task<IActionResult> Seed(SeedRequest req, CancellationToken ct)
    {
        if (env.IsProduction()) return NotFound();
        if (string.IsNullOrWhiteSpace(req.Password) || req.Password.Length < 10) return BadRequest(new { title = "Passwort mit mindestens 10 Zeichen angeben." });
        var result = await services.GetRequiredService<DemoSeeder>().SeedAsync(req.Password, null, ct);
        return Ok(result);
    }

    /// <summary>Lists e-mails captured by the in-memory dev mailbox (invitation, verification, reset links).</summary>
    [HttpGet("emails")]
    public IActionResult Emails([FromQuery] string? to)
    {
        if (env.IsProduction()) return NotFound();
        var mailbox = services.GetService<DevMailbox>();
        if (mailbox is null) return NotFound(new { title = "Dev-Postfach ist nicht aktiviert (Email:UseDevMailbox)." });
        return Ok(mailbox.All(to).Select(m => new { m.SentAt, m.To, m.Subject, m.Text }));
    }

    [HttpPost("outbox/process")]
    public async Task<IActionResult> ProcessOutbox(CancellationToken ct)
    {
        if (env.IsProduction()) return NotFound();
        var processed = await services.GetRequiredService<OutboxProcessor>().ProcessBatchAsync(ct);
        return Ok(new { processed });
    }

    [HttpGet("migrations")]
    public async Task<IActionResult> Migrations(CancellationToken ct)
    {
        if (env.IsProduction()) return NotFound();
        var db = services.GetRequiredService<AppDbContext>();
        return Ok(new { applied = await db.Database.GetAppliedMigrationsAsync(ct), pending = await db.Database.GetPendingMigrationsAsync(ct) });
    }
}
