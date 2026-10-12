using GastroTeam.Application.Common;
using GastroTeam.Application.Features.Auth;
using GastroTeam.Domain.Entities;
using GastroTeam.Infrastructure.Identity;
using GastroTeam.Infrastructure.Messaging;
using GastroTeam.Infrastructure.Persistence;
using GastroTeam.Infrastructure.Seeding;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace GastroTeam.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration config, IHostEnvironment env)
    {
        var connection = config.GetConnectionString("Default")
                         ?? throw new InvalidOperationException("ConnectionStrings:Default is not configured.");
        services.AddDbContext<AppDbContext>(o => o.UseSqlServer(connection, sql => sql.CommandTimeout(60)));
        services.AddScoped<IAppDbContext>(sp => sp.GetRequiredService<AppDbContext>());

        services.Configure<AppOptions>(config.GetSection(AppOptions.Section));
        services.Configure<AuthOptions>(config.GetSection(AuthOptions.Section));
        services.Configure<JwtOptions>(config.GetSection(JwtOptions.Section));
        services.Configure<EmailOptions>(config.GetSection(EmailOptions.Section));

        services.AddIdentityCore<ApplicationUser>(o =>
            {
                o.Password.RequiredLength = 10;
                o.Password.RequireDigit = false;
                o.Password.RequireLowercase = false;
                o.Password.RequireUppercase = false;
                o.Password.RequireNonAlphanumeric = false;
                o.Lockout.AllowedForNewUsers = true;
                o.Lockout.MaxFailedAccessAttempts = 5;
                o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
                o.User.RequireUniqueEmail = true;
                o.Tokens.EmailConfirmationTokenProvider = "EmailConfirmationProvider";
            })
            .AddEntityFrameworkStores<AppDbContext>()
            .AddDefaultTokenProviders()
            .AddTokenProvider<EmailConfirmationTokenProvider<ApplicationUser>>("EmailConfirmationProvider");
        services.Configure<DataProtectionTokenProviderOptions>(o => o.TokenLifespan = TimeSpan.FromHours(2));

        // Keys are stored in the database so tokens survive restarts and work across instances.
        services.AddDataProtection().SetApplicationName("GastroTeam").PersistKeysToDbContext<AppDbContext>();

        services.AddSingleton<ITokenService, TokenService>();

        var email = config.GetSection(EmailOptions.Section).Get<EmailOptions>() ?? new EmailOptions();
        if (email.UseDevMailbox && !env.IsProduction())
        {
            services.AddSingleton<DevMailbox>();
            services.AddSingleton<IEmailSender>(sp => sp.GetRequiredService<DevMailbox>());
        }
        else if (!string.IsNullOrWhiteSpace(email.SmtpHost))
            services.AddSingleton<IEmailSender, SmtpEmailSender>();
        else
            services.AddSingleton<IEmailSender, DisabledEmailSender>();

        services.AddHttpClient<IPushSender, ExpoPushSender>(c => c.Timeout = TimeSpan.FromSeconds(15));
        services.AddSingleton<OutboxProcessor>();
        if (config.GetValue("Outbox:Enabled", true)) services.AddHostedService(sp => sp.GetRequiredService<OutboxProcessor>());

        services.AddScoped<DemoSeeder>();
        return services;
    }
}
