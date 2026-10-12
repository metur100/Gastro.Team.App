using GastroTeam.Application.Common;
using GastroTeam.Application.Features.Account;
using GastroTeam.Application.Features.Auth;
using GastroTeam.Application.Features.Availability;
using GastroTeam.Application.Features.Billing;
using GastroTeam.Application.Features.Dashboard;
using GastroTeam.Application.Features.Employees;
using GastroTeam.Application.Features.Invitations;
using GastroTeam.Application.Features.Leave;
using GastroTeam.Application.Features.Locations;
using GastroTeam.Application.Features.Notifications;
using GastroTeam.Application.Features.Reports;
using GastroTeam.Application.Features.Scheduling;
using GastroTeam.Application.Features.Swaps;
using GastroTeam.Application.Features.Tenants;
using FluentValidation;
using Microsoft.Extensions.DependencyInjection;

namespace GastroTeam.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddValidatorsFromAssembly(typeof(DependencyInjection).Assembly, includeInternalTypes: true);
        services.AddSingleton<IClock, SystemClock>();
        services.AddScoped<RequestContext>();
        services.AddScoped<Access>();
        services.AddScoped<TenantResolver>();
        services.AddScoped<AuditLogger>();
        services.AddScoped<Notifier>();
        services.AddScoped<ScheduleValidationBuilder>();

        services.AddScoped<AuthService>();
        services.AddScoped<AccountService>();
        services.AddScoped<OnboardingService>();
        services.AddScoped<TenantSettingsService>();
        services.AddScoped<LocationService>();
        services.AddScoped<JobRoleService>();
        services.AddScoped<EmployeeService>();
        services.AddScoped<InvitationService>();
        services.AddScoped<MemberService>();
        services.AddScoped<ShiftService>();
        services.AddScoped<ScheduleService>();
        services.AddScoped<AvailabilityService>();
        services.AddScoped<LeaveService>();
        services.AddScoped<SwapService>();
        services.AddScoped<NotificationQueryService>();
        services.AddScoped<DashboardService>();
        services.AddScoped<ReportService>();
        services.AddScoped<SubscriptionService>();
        services.AddScoped<PlatformService>();
        services.AddScoped<AuditQueryService>();
        return services;
    }
}
