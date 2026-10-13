using System.Collections.Concurrent;
using System.Net.Http.Json;
using GastroTeam.Application.Common;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MimeKit;

namespace GastroTeam.Infrastructure.Messaging;

public sealed class EmailOptions
{
    public const string Section = "Email";
    public string? SmtpHost { get; set; }
    public int SmtpPort { get; set; } = 587;
    public string? SmtpUser { get; set; }
    public string? SmtpPassword { get; set; }
    public bool UseStartTls { get; set; } = true;
    public string FromAddress { get; set; } = "no-reply@gastroteam.example";
    public string FromName { get; set; } = "GastroTeam";
    /// <summary>Development/testing only: keep e-mails in memory and expose them via the dev endpoint.</summary>
    public bool UseDevMailbox { get; set; }
}

public sealed class SmtpEmailSender(IOptions<EmailOptions> options, ILogger<SmtpEmailSender> logger) : IEmailSender
{
    private readonly EmailOptions _opt = options.Value;
    public bool IsConfigured => true;

    public async Task SendAsync(string to, string subject, string htmlBody, string textBody, CancellationToken ct)
    {
        var message = new MimeMessage();
        message.From.Add(new MailboxAddress(_opt.FromName, _opt.FromAddress));
        message.To.Add(MailboxAddress.Parse(to));
        message.Subject = subject;
        message.Body = new BodyBuilder { HtmlBody = htmlBody, TextBody = textBody }.ToMessageBody();
        using var client = new SmtpClient();
        await client.ConnectAsync(_opt.SmtpHost!, _opt.SmtpPort, _opt.UseStartTls ? SecureSocketOptions.StartTls : SecureSocketOptions.Auto, ct);
        if (!string.IsNullOrEmpty(_opt.SmtpUser)) await client.AuthenticateAsync(_opt.SmtpUser, _opt.SmtpPassword ?? "", ct);
        await client.SendAsync(message, ct);
        await client.DisconnectAsync(true, ct);
        logger.LogInformation("E-mail '{Subject}' sent", subject);
    }
}

public sealed record DevEmail(DateTime SentAt, string To, string Subject, string Html, string Text);

/// <summary>In-memory mailbox for local development and automated tests. Never registered in production.</summary>
public sealed class DevMailbox : IEmailSender
{
    private readonly ConcurrentQueue<DevEmail> _mails = new();
    public bool IsConfigured => true;

    public Task SendAsync(string to, string subject, string htmlBody, string textBody, CancellationToken ct)
    {
        _mails.Enqueue(new DevEmail(DateTime.UtcNow, to, subject, htmlBody, textBody));
        while (_mails.Count > 500) _mails.TryDequeue(out _);
        return Task.CompletedTask;
    }

    public IReadOnlyList<DevEmail> All(string? to = null) =>
        _mails.Where(m => to is null || string.Equals(m.To, to, StringComparison.OrdinalIgnoreCase)).Reverse().ToList();
}

/// <summary>Used when no e-mail provider is configured. Logs only metadata, never content or links.</summary>
public sealed class DisabledEmailSender(ILogger<DisabledEmailSender> logger) : IEmailSender
{
    public bool IsConfigured => false;

    public Task SendAsync(string to, string subject, string htmlBody, string textBody, CancellationToken ct)
    {
        logger.LogWarning("E-mail provider not configured; e-mail '{Subject}' was not sent", subject);
        return Task.CompletedTask;
    }
}

/// <summary>Sends push messages through the Expo push service (no credentials required for basic use).</summary>
public sealed class ExpoPushSender(HttpClient http, ILogger<ExpoPushSender> logger) : IPushSender
{
    public async Task SendAsync(IReadOnlyList<string> deviceTokens, string title, string body, string? link, CancellationToken ct)
    {
        var messages = deviceTokens.Where(t => t.StartsWith("ExponentPushToken[", StringComparison.Ordinal) || t.StartsWith("ExpoPushToken[", StringComparison.Ordinal))
            .Select(t => new { to = t, title, body, sound = "default", data = new { link } }).ToList();
        if (messages.Count == 0) return;
        using var response = await http.PostAsJsonAsync("https://exp.host/--/api/v2/push/send", messages, ct);
        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning("Expo push returned {Status}", (int)response.StatusCode);
            response.EnsureSuccessStatusCode();
        }
    }
}
