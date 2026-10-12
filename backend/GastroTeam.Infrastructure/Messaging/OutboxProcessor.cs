using System.Net;
using System.Text.Json;
using GastroTeam.Application.Common;
using GastroTeam.Application.Features.Auth;
using GastroTeam.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace GastroTeam.Infrastructure.Messaging;

/// <summary>
/// Delivers e-mail and push messages for notifications that were committed together with their business
/// change (transactional outbox). Retries with backoff; failures never affect the original operation.
/// </summary>
public sealed class OutboxProcessor(IServiceScopeFactory scopes, ILogger<OutboxProcessor> logger) : BackgroundService
{
    private const int MaxAttempts = 5;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Give the app time to start (and migrations to be applied by the operator) before polling.
        await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var processed = await ProcessBatchAsync(stoppingToken);
                if (processed == 0) await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Outbox processing failed");
                await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
            }
        }
    }

    public async Task<int> ProcessBatchAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var email = scope.ServiceProvider.GetRequiredService<IEmailSender>();
        var push = scope.ServiceProvider.GetRequiredService<IPushSender>();
        var app = scope.ServiceProvider.GetRequiredService<IOptions<AppOptions>>().Value;
        var now = DateTime.UtcNow;

        var batch = await db.OutboxMessages.Where(m => m.ProcessedAt == null && m.NextAttemptAt <= now)
            .OrderBy(m => m.CreatedAt).Take(20).ToListAsync(ct);
        foreach (var message in batch)
        {
            try
            {
                if (message.Type == "notification.deliver")
                {
                    var payload = JsonSerializer.Deserialize<OutboxNotificationPayload>(message.Payload)!;
                    var user = await db.Users.Where(u => u.Id == payload.UserId && !u.IsDeleted)
                        .Select(u => new { u.Email, u.FirstName }).SingleOrDefaultAsync(ct);
                    if (user is not null)
                    {
                        if (payload.SendEmail && email.IsConfigured && user.Email is not null)
                        {
                            var link = payload.Link is null ? null : app.WebBaseUrl + payload.Link;
                            await email.SendAsync(user.Email, payload.Title,
                                EmailTemplates.Wrap(payload.Title, $"<p>Hallo {WebUtility.HtmlEncode(user.FirstName)},</p><p>{WebUtility.HtmlEncode(payload.Body)}</p>", link, "In GastroTeam öffnen"),
                                $"{payload.Body}\n\n{link}", ct);
                        }
                        var tokens = await db.PushDevices.Where(p => p.UserId == payload.UserId).Select(p => p.Token).ToListAsync(ct);
                        if (tokens.Count > 0) await push.SendAsync(tokens, payload.Title, payload.Body, payload.Link, ct);
                    }
                }
                message.ProcessedAt = DateTime.UtcNow;
                message.LastError = null;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                message.Attempts++;
                message.LastError = ex.GetType().Name; // no message content: may contain addresses
                message.NextAttemptAt = DateTime.UtcNow.AddMinutes(Math.Pow(2, message.Attempts));
                if (message.Attempts >= MaxAttempts) message.ProcessedAt = DateTime.UtcNow;
                logger.LogWarning("Outbox message {MessageId} failed (attempt {Attempt}): {Error}", message.Id, message.Attempts, ex.GetType().Name);
            }
        }
        await db.SaveChangesAsync(ct);
        return batch.Count;
    }
}
