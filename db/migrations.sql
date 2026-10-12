IF OBJECT_ID(N'[__EFMigrationsHistory]') IS NULL
BEGIN
    CREATE TABLE [__EFMigrationsHistory] (
        [MigrationId] nvarchar(150) NOT NULL,
        [ProductVersion] nvarchar(32) NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [AspNetRoles] (
        [Id] uniqueidentifier NOT NULL,
        [Name] nvarchar(256) NULL,
        [NormalizedName] nvarchar(256) NULL,
        [ConcurrencyStamp] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetRoles] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [AspNetUsers] (
        [Id] uniqueidentifier NOT NULL,
        [FirstName] nvarchar(100) NOT NULL,
        [LastName] nvarchar(100) NOT NULL,
        [PreferredLanguage] nvarchar(10) NOT NULL,
        [IsPlatformAdmin] bit NOT NULL,
        [IsDeleted] bit NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [LastLoginAt] datetime2 NULL,
        [UserName] nvarchar(256) NULL,
        [NormalizedUserName] nvarchar(256) NULL,
        [Email] nvarchar(256) NULL,
        [NormalizedEmail] nvarchar(256) NULL,
        [EmailConfirmed] bit NOT NULL,
        [PasswordHash] nvarchar(max) NULL,
        [SecurityStamp] nvarchar(max) NULL,
        [ConcurrencyStamp] nvarchar(max) NULL,
        [PhoneNumber] nvarchar(max) NULL,
        [PhoneNumberConfirmed] bit NOT NULL,
        [TwoFactorEnabled] bit NOT NULL,
        [LockoutEnd] datetimeoffset NULL,
        [LockoutEnabled] bit NOT NULL,
        [AccessFailedCount] int NOT NULL,
        CONSTRAINT [PK_AspNetUsers] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [AuditLogs] (
        [Id] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NULL,
        [UserId] uniqueidentifier NULL,
        [Action] nvarchar(80) NOT NULL,
        [EntityType] nvarchar(40) NOT NULL,
        [EntityId] uniqueidentifier NULL,
        [Details] nvarchar(max) NULL,
        [IpAddress] nvarchar(64) NULL,
        [CreatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_AuditLogs] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [DataProtectionKeys] (
        [Id] int NOT NULL IDENTITY,
        [FriendlyName] nvarchar(max) NULL,
        [Xml] nvarchar(max) NULL,
        CONSTRAINT [PK_DataProtectionKeys] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [OutboxMessages] (
        [Id] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NULL,
        [Type] nvarchar(60) NOT NULL,
        [Payload] nvarchar(max) NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [NextAttemptAt] datetime2 NOT NULL,
        [ProcessedAt] datetime2 NULL,
        [Attempts] int NOT NULL,
        [LastError] nvarchar(1000) NULL,
        CONSTRAINT [PK_OutboxMessages] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [SubscriptionPlans] (
        [Code] nvarchar(30) NOT NULL,
        [Name] nvarchar(60) NOT NULL,
        [MonthlyPriceEur] decimal(10,2) NOT NULL,
        [MaxLocations] int NOT NULL,
        [MaxActiveEmployees] int NOT NULL,
        [Features] int NOT NULL,
        [SortOrder] int NOT NULL,
        [IsActive] bit NOT NULL,
        CONSTRAINT [PK_SubscriptionPlans] PRIMARY KEY ([Code])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [Tenants] (
        [Id] uniqueidentifier NOT NULL,
        [Name] nvarchar(150) NOT NULL,
        [ContactEmail] nvarchar(256) NULL,
        [Phone] nvarchar(40) NULL,
        [LogoUrl] nvarchar(500) NULL,
        [DefaultLanguage] nvarchar(10) NOT NULL,
        [DefaultTimeZone] nvarchar(64) NOT NULL,
        [Status] int NOT NULL,
        [SuspensionReason] nvarchar(500) NULL,
        [OnboardingStep] int NOT NULL,
        [OnboardingCompletedAt] datetime2 NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_Tenants] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [AspNetRoleClaims] (
        [Id] int NOT NULL IDENTITY,
        [RoleId] uniqueidentifier NOT NULL,
        [ClaimType] nvarchar(max) NULL,
        [ClaimValue] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetRoleClaims] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_AspNetRoleClaims_AspNetRoles_RoleId] FOREIGN KEY ([RoleId]) REFERENCES [AspNetRoles] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [AspNetUserClaims] (
        [Id] int NOT NULL IDENTITY,
        [UserId] uniqueidentifier NOT NULL,
        [ClaimType] nvarchar(max) NULL,
        [ClaimValue] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetUserClaims] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_AspNetUserClaims_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [AspNetUserLogins] (
        [LoginProvider] nvarchar(450) NOT NULL,
        [ProviderKey] nvarchar(450) NOT NULL,
        [ProviderDisplayName] nvarchar(max) NULL,
        [UserId] uniqueidentifier NOT NULL,
        CONSTRAINT [PK_AspNetUserLogins] PRIMARY KEY ([LoginProvider], [ProviderKey]),
        CONSTRAINT [FK_AspNetUserLogins_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [AspNetUserRoles] (
        [UserId] uniqueidentifier NOT NULL,
        [RoleId] uniqueidentifier NOT NULL,
        CONSTRAINT [PK_AspNetUserRoles] PRIMARY KEY ([UserId], [RoleId]),
        CONSTRAINT [FK_AspNetUserRoles_AspNetRoles_RoleId] FOREIGN KEY ([RoleId]) REFERENCES [AspNetRoles] ([Id]) ON DELETE CASCADE,
        CONSTRAINT [FK_AspNetUserRoles_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [AspNetUserTokens] (
        [UserId] uniqueidentifier NOT NULL,
        [LoginProvider] nvarchar(450) NOT NULL,
        [Name] nvarchar(450) NOT NULL,
        [Value] nvarchar(max) NULL,
        CONSTRAINT [PK_AspNetUserTokens] PRIMARY KEY ([UserId], [LoginProvider], [Name]),
        CONSTRAINT [FK_AspNetUserTokens_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [PushDevices] (
        [Id] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [Token] nvarchar(300) NOT NULL,
        [Platform] nvarchar(10) NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [LastSeenAt] datetime2 NOT NULL,
        CONSTRAINT [PK_PushDevices] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_PushDevices_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [RefreshTokens] (
        [Id] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [TokenHash] nvarchar(64) NOT NULL,
        [FamilyId] uniqueidentifier NOT NULL,
        [FamilyCreatedAt] datetime2 NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [ExpiresAt] datetime2 NOT NULL,
        [RevokedAt] datetime2 NULL,
        [RevokedReason] nvarchar(40) NULL,
        [ReplacedByTokenId] uniqueidentifier NULL,
        [CreatedByIp] nvarchar(64) NULL,
        [UserAgent] nvarchar(300) NULL,
        CONSTRAINT [PK_RefreshTokens] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_RefreshTokens_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [JobRoles] (
        [Id] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NOT NULL,
        [Name] nvarchar(60) NOT NULL,
        [Color] nvarchar(7) NOT NULL,
        [SortOrder] int NOT NULL,
        [IsActive] bit NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_JobRoles] PRIMARY KEY ([Id]),
        CONSTRAINT [AK_JobRoles_TenantId_Id] UNIQUE ([TenantId], [Id]),
        CONSTRAINT [FK_JobRoles_Tenants_TenantId] FOREIGN KEY ([TenantId]) REFERENCES [Tenants] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [Locations] (
        [Id] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NOT NULL,
        [Name] nvarchar(120) NOT NULL,
        [Street] nvarchar(150) NULL,
        [PostalCode] nvarchar(10) NULL,
        [City] nvarchar(100) NULL,
        [Country] nvarchar(2) NOT NULL,
        [TimeZoneId] nvarchar(64) NOT NULL,
        [Phone] nvarchar(40) NULL,
        [Email] nvarchar(256) NULL,
        [IsActive] bit NOT NULL,
        [MinStaffPerDay] int NOT NULL,
        [DefaultBreakMinutes] int NOT NULL,
        [PrepBufferMinutes] int NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_Locations] PRIMARY KEY ([Id]),
        CONSTRAINT [AK_Locations_TenantId_Id] UNIQUE ([TenantId], [Id]),
        CONSTRAINT [FK_Locations_Tenants_TenantId] FOREIGN KEY ([TenantId]) REFERENCES [Tenants] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [Memberships] (
        [Id] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [Role] int NOT NULL,
        [Permissions] int NOT NULL,
        [IsActive] bit NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_Memberships] PRIMARY KEY ([Id]),
        CONSTRAINT [AK_Memberships_TenantId_Id] UNIQUE ([TenantId], [Id]),
        CONSTRAINT [FK_Memberships_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_Memberships_Tenants_TenantId] FOREIGN KEY ([TenantId]) REFERENCES [Tenants] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [Notifications] (
        [Id] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [Type] nvarchar(40) NOT NULL,
        [Title] nvarchar(200) NOT NULL,
        [Body] nvarchar(1000) NOT NULL,
        [Link] nvarchar(300) NULL,
        [DedupKey] nvarchar(200) NULL,
        [CreatedAt] datetime2 NOT NULL,
        [ReadAt] datetime2 NULL,
        CONSTRAINT [PK_Notifications] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Notifications_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_Notifications_Tenants_TenantId] FOREIGN KEY ([TenantId]) REFERENCES [Tenants] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [Subscriptions] (
        [Id] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NOT NULL,
        [PlanCode] nvarchar(30) NOT NULL,
        [Status] int NOT NULL,
        [TrialEndsAt] datetime2 NULL,
        [CurrentPeriodEnd] datetime2 NULL,
        [CancelledAt] datetime2 NULL,
        [IsTestMode] bit NOT NULL,
        [ExternalCustomerId] nvarchar(100) NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_Subscriptions] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Subscriptions_SubscriptionPlans_PlanCode] FOREIGN KEY ([PlanCode]) REFERENCES [SubscriptionPlans] ([Code]) ON DELETE NO ACTION,
        CONSTRAINT [FK_Subscriptions_Tenants_TenantId] FOREIGN KEY ([TenantId]) REFERENCES [Tenants] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [TenantSettings] (
        [TenantId] uniqueidentifier NOT NULL,
        [UnassignedShiftsBlockPublish] bit NOT NULL,
        [MaxShiftHours] decimal(5,2) NOT NULL,
        [MaxDailyHours] decimal(5,2) NOT NULL,
        [MaxWeeklyHours] decimal(5,2) NOT NULL,
        [MinRestHours] decimal(5,2) NOT NULL,
        [CheckBreakRules] bit NOT NULL,
        [SwapRequiresManagerApproval] bit NOT NULL,
        [AllowOpenSwapOffers] bit NOT NULL,
        [EmployeesSeeColleagueShifts] bit NOT NULL,
        [RuleSetVersion] nvarchar(40) NOT NULL,
        [UpdatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_TenantSettings] PRIMARY KEY ([TenantId]),
        CONSTRAINT [FK_TenantSettings_Tenants_TenantId] FOREIGN KEY ([TenantId]) REFERENCES [Tenants] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [Employees] (
        [Id] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NOT NULL,
        [UserId] uniqueidentifier NULL,
        [FirstName] nvarchar(100) NOT NULL,
        [LastName] nvarchar(100) NOT NULL,
        [Email] nvarchar(256) NULL,
        [NormalizedEmail] nvarchar(256) NULL,
        [Phone] nvarchar(40) NULL,
        [ProfileImageUrl] nvarchar(500) NULL,
        [JobRoleId] uniqueidentifier NULL,
        [Status] int NOT NULL,
        [ContractHoursPerWeek] decimal(5,2) NULL,
        [EmploymentStartDate] date NULL,
        [EmploymentEndDate] date NULL,
        [PreferredLanguage] nvarchar(10) NOT NULL,
        [Notes] nvarchar(1000) NULL,
        [AnonymizedAt] datetime2 NULL,
        [RowVersion] rowversion NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_Employees] PRIMARY KEY ([Id]),
        CONSTRAINT [AK_Employees_TenantId_Id] UNIQUE ([TenantId], [Id]),
        CONSTRAINT [FK_Employees_AspNetUsers_UserId] FOREIGN KEY ([UserId]) REFERENCES [AspNetUsers] ([Id]),
        CONSTRAINT [FK_Employees_JobRoles_TenantId_JobRoleId] FOREIGN KEY ([TenantId], [JobRoleId]) REFERENCES [JobRoles] ([TenantId], [Id]),
        CONSTRAINT [FK_Employees_Tenants_TenantId] FOREIGN KEY ([TenantId]) REFERENCES [Tenants] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [OpeningHours] (
        [Id] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NOT NULL,
        [LocationId] uniqueidentifier NOT NULL,
        [DayOfWeek] int NOT NULL,
        [IsClosed] bit NOT NULL,
        [OpensAt] time NOT NULL,
        [ClosesAt] time NOT NULL,
        CONSTRAINT [PK_OpeningHours] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_OpeningHours_Locations_TenantId_LocationId] FOREIGN KEY ([TenantId], [LocationId]) REFERENCES [Locations] ([TenantId], [Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [ShiftPublications] (
        [Id] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NOT NULL,
        [LocationId] uniqueidentifier NOT NULL,
        [WeekStart] date NOT NULL,
        [Action] int NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UserId] uniqueidentifier NOT NULL,
        [ShiftCount] int NOT NULL,
        [WarningCount] int NOT NULL,
        CONSTRAINT [PK_ShiftPublications] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_ShiftPublications_Locations_TenantId_LocationId] FOREIGN KEY ([TenantId], [LocationId]) REFERENCES [Locations] ([TenantId], [Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [MembershipLocations] (
        [MembershipId] uniqueidentifier NOT NULL,
        [LocationId] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NOT NULL,
        CONSTRAINT [PK_MembershipLocations] PRIMARY KEY ([MembershipId], [LocationId]),
        CONSTRAINT [FK_MembershipLocations_Locations_TenantId_LocationId] FOREIGN KEY ([TenantId], [LocationId]) REFERENCES [Locations] ([TenantId], [Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_MembershipLocations_Memberships_TenantId_MembershipId] FOREIGN KEY ([TenantId], [MembershipId]) REFERENCES [Memberships] ([TenantId], [Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [Availability] (
        [Id] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NOT NULL,
        [EmployeeId] uniqueidentifier NOT NULL,
        [DayOfWeek] int NOT NULL,
        [StartTime] time NOT NULL,
        [EndTime] time NOT NULL,
        [Kind] int NOT NULL,
        [Note] nvarchar(200) NULL,
        [ValidFrom] date NOT NULL,
        [ValidTo] date NULL,
        [CreatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_Availability] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Availability_Employees_TenantId_EmployeeId] FOREIGN KEY ([TenantId], [EmployeeId]) REFERENCES [Employees] ([TenantId], [Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [AvailabilityExceptions] (
        [Id] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NOT NULL,
        [EmployeeId] uniqueidentifier NOT NULL,
        [Date] date NOT NULL,
        [StartTime] time NULL,
        [EndTime] time NULL,
        [Note] nvarchar(200) NULL,
        [CreatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_AvailabilityExceptions] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_AvailabilityExceptions_Employees_TenantId_EmployeeId] FOREIGN KEY ([TenantId], [EmployeeId]) REFERENCES [Employees] ([TenantId], [Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [EmployeeLocations] (
        [EmployeeId] uniqueidentifier NOT NULL,
        [LocationId] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NOT NULL,
        CONSTRAINT [PK_EmployeeLocations] PRIMARY KEY ([EmployeeId], [LocationId]),
        CONSTRAINT [FK_EmployeeLocations_Employees_TenantId_EmployeeId] FOREIGN KEY ([TenantId], [EmployeeId]) REFERENCES [Employees] ([TenantId], [Id]),
        CONSTRAINT [FK_EmployeeLocations_Locations_TenantId_LocationId] FOREIGN KEY ([TenantId], [LocationId]) REFERENCES [Locations] ([TenantId], [Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [Invitations] (
        [Id] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NOT NULL,
        [Email] nvarchar(256) NOT NULL,
        [FirstName] nvarchar(100) NOT NULL,
        [LastName] nvarchar(100) NOT NULL,
        [Role] int NOT NULL,
        [Permissions] int NOT NULL,
        [EmployeeId] uniqueidentifier NULL,
        [LocationIds] nvarchar(2000) NOT NULL,
        [TokenHash] nvarchar(64) NOT NULL,
        [ExpiresAt] datetime2 NOT NULL,
        [AcceptedAt] datetime2 NULL,
        [AcceptedByUserId] uniqueidentifier NULL,
        [RevokedAt] datetime2 NULL,
        [InvitedByUserId] uniqueidentifier NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_Invitations] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_Invitations_Employees_TenantId_EmployeeId] FOREIGN KEY ([TenantId], [EmployeeId]) REFERENCES [Employees] ([TenantId], [Id]),
        CONSTRAINT [FK_Invitations_Tenants_TenantId] FOREIGN KEY ([TenantId]) REFERENCES [Tenants] ([Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [LeaveRequests] (
        [Id] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NOT NULL,
        [EmployeeId] uniqueidentifier NOT NULL,
        [Type] int NOT NULL,
        [StartDate] date NOT NULL,
        [EndDate] date NOT NULL,
        [Note] nvarchar(500) NULL,
        [Status] int NOT NULL,
        [DecisionReason] nvarchar(500) NULL,
        [DecidedByUserId] uniqueidentifier NULL,
        [DecidedAt] datetime2 NULL,
        [RowVersion] rowversion NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_LeaveRequests] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_LeaveRequests_Range] CHECK ([EndDate] >= [StartDate]),
        CONSTRAINT [FK_LeaveRequests_Employees_TenantId_EmployeeId] FOREIGN KEY ([TenantId], [EmployeeId]) REFERENCES [Employees] ([TenantId], [Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [Shifts] (
        [Id] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NOT NULL,
        [LocationId] uniqueidentifier NOT NULL,
        [EmployeeId] uniqueidentifier NULL,
        [JobRoleId] uniqueidentifier NOT NULL,
        [StartUtc] datetime2 NOT NULL,
        [EndUtc] datetime2 NOT NULL,
        [LocalDate] date NOT NULL,
        [BreakMinutes] int NOT NULL,
        [Notes] nvarchar(500) NULL,
        [Status] int NOT NULL,
        [CreatedByUserId] uniqueidentifier NOT NULL,
        [PublishedAt] datetime2 NULL,
        [CancelledAt] datetime2 NULL,
        [RowVersion] rowversion NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_Shifts] PRIMARY KEY ([Id]),
        CONSTRAINT [AK_Shifts_TenantId_Id] UNIQUE ([TenantId], [Id]),
        CONSTRAINT [CK_Shifts_Interval] CHECK ([EndUtc] > [StartUtc] AND [BreakMinutes] >= 0),
        CONSTRAINT [FK_Shifts_Employees_TenantId_EmployeeId] FOREIGN KEY ([TenantId], [EmployeeId]) REFERENCES [Employees] ([TenantId], [Id]),
        CONSTRAINT [FK_Shifts_JobRoles_TenantId_JobRoleId] FOREIGN KEY ([TenantId], [JobRoleId]) REFERENCES [JobRoles] ([TenantId], [Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_Shifts_Locations_TenantId_LocationId] FOREIGN KEY ([TenantId], [LocationId]) REFERENCES [Locations] ([TenantId], [Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE TABLE [ShiftSwaps] (
        [Id] uniqueidentifier NOT NULL,
        [TenantId] uniqueidentifier NOT NULL,
        [ShiftId] uniqueidentifier NOT NULL,
        [RequesterEmployeeId] uniqueidentifier NOT NULL,
        [TargetEmployeeId] uniqueidentifier NULL,
        [AcceptedByEmployeeId] uniqueidentifier NULL,
        [Status] int NOT NULL,
        [Message] nvarchar(300) NULL,
        [DecisionReason] nvarchar(500) NULL,
        [OriginalEmployeeId] uniqueidentifier NOT NULL,
        [FinalEmployeeId] uniqueidentifier NULL,
        [DecidedByUserId] uniqueidentifier NULL,
        [CompletedAt] datetime2 NULL,
        [RowVersion] rowversion NOT NULL,
        [CreatedAt] datetime2 NOT NULL,
        [UpdatedAt] datetime2 NOT NULL,
        CONSTRAINT [PK_ShiftSwaps] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_ShiftSwaps_Employees_TenantId_AcceptedByEmployeeId] FOREIGN KEY ([TenantId], [AcceptedByEmployeeId]) REFERENCES [Employees] ([TenantId], [Id]),
        CONSTRAINT [FK_ShiftSwaps_Employees_TenantId_RequesterEmployeeId] FOREIGN KEY ([TenantId], [RequesterEmployeeId]) REFERENCES [Employees] ([TenantId], [Id]) ON DELETE NO ACTION,
        CONSTRAINT [FK_ShiftSwaps_Employees_TenantId_TargetEmployeeId] FOREIGN KEY ([TenantId], [TargetEmployeeId]) REFERENCES [Employees] ([TenantId], [Id]),
        CONSTRAINT [FK_ShiftSwaps_Shifts_TenantId_ShiftId] FOREIGN KEY ([TenantId], [ShiftId]) REFERENCES [Shifts] ([TenantId], [Id]) ON DELETE NO ACTION
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    IF EXISTS (SELECT * FROM [sys].[identity_columns] WHERE [name] IN (N'Code', N'Features', N'IsActive', N'MaxActiveEmployees', N'MaxLocations', N'MonthlyPriceEur', N'Name', N'SortOrder') AND [object_id] = OBJECT_ID(N'[SubscriptionPlans]'))
        SET IDENTITY_INSERT [SubscriptionPlans] ON;
    EXEC(N'INSERT INTO [SubscriptionPlans] ([Code], [Features], [IsActive], [MaxActiveEmployees], [MaxLocations], [MonthlyPriceEur], [Name], [SortOrder])
    VALUES (N''business'', 63, CAST(1 AS bit), 40, 5, 79.0, N''Business'', 3),
    (N''starter'', 0, CAST(1 AS bit), 5, 1, 19.0, N''Starter'', 1),
    (N''team'', 15, CAST(1 AS bit), 15, 1, 39.0, N''Team'', 2)');
    IF EXISTS (SELECT * FROM [sys].[identity_columns] WHERE [name] IN (N'Code', N'Features', N'IsActive', N'MaxActiveEmployees', N'MaxLocations', N'MonthlyPriceEur', N'Name', N'SortOrder') AND [object_id] = OBJECT_ID(N'[SubscriptionPlans]'))
        SET IDENTITY_INSERT [SubscriptionPlans] OFF;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_AspNetRoleClaims_RoleId] ON [AspNetRoleClaims] ([RoleId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [RoleNameIndex] ON [AspNetRoles] ([NormalizedName]) WHERE [NormalizedName] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_AspNetUserClaims_UserId] ON [AspNetUserClaims] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_AspNetUserLogins_UserId] ON [AspNetUserLogins] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_AspNetUserRoles_RoleId] ON [AspNetUserRoles] ([RoleId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [EmailIndex] ON [AspNetUsers] ([NormalizedEmail]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [UserNameIndex] ON [AspNetUsers] ([NormalizedUserName]) WHERE [NormalizedUserName] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_AuditLogs_TenantId_CreatedAt] ON [AuditLogs] ([TenantId], [CreatedAt]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_AuditLogs_TenantId_EntityType_EntityId] ON [AuditLogs] ([TenantId], [EntityType], [EntityId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_Availability_TenantId_EmployeeId_ValidFrom] ON [Availability] ([TenantId], [EmployeeId], [ValidFrom]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_AvailabilityExceptions_TenantId_EmployeeId_Date] ON [AvailabilityExceptions] ([TenantId], [EmployeeId], [Date]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_EmployeeLocations_TenantId_EmployeeId] ON [EmployeeLocations] ([TenantId], [EmployeeId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_EmployeeLocations_TenantId_LocationId] ON [EmployeeLocations] ([TenantId], [LocationId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_Employees_TenantId_JobRoleId] ON [Employees] ([TenantId], [JobRoleId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_Employees_TenantId_NormalizedEmail] ON [Employees] ([TenantId], [NormalizedEmail]) WHERE [NormalizedEmail] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_Employees_TenantId_Status_LastName] ON [Employees] ([TenantId], [Status], [LastName]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_Employees_TenantId_UserId] ON [Employees] ([TenantId], [UserId]) WHERE [UserId] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_Employees_UserId] ON [Employees] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_Invitations_TenantId_Email] ON [Invitations] ([TenantId], [Email]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_Invitations_TenantId_EmployeeId] ON [Invitations] ([TenantId], [EmployeeId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Invitations_TokenHash] ON [Invitations] ([TokenHash]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE UNIQUE INDEX [IX_JobRoles_TenantId_Name] ON [JobRoles] ([TenantId], [Name]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_LeaveRequests_TenantId_EmployeeId_StartDate] ON [LeaveRequests] ([TenantId], [EmployeeId], [StartDate]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_LeaveRequests_TenantId_Status] ON [LeaveRequests] ([TenantId], [Status]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_MembershipLocations_TenantId_LocationId] ON [MembershipLocations] ([TenantId], [LocationId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_MembershipLocations_TenantId_MembershipId] ON [MembershipLocations] ([TenantId], [MembershipId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Memberships_TenantId_UserId] ON [Memberships] ([TenantId], [UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_Memberships_UserId] ON [Memberships] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_Notifications_DedupKey] ON [Notifications] ([DedupKey]) WHERE [DedupKey] IS NOT NULL');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_Notifications_TenantId_UserId_ReadAt_CreatedAt] ON [Notifications] ([TenantId], [UserId], [ReadAt], [CreatedAt]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_Notifications_UserId] ON [Notifications] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE UNIQUE INDEX [IX_OpeningHours_LocationId_DayOfWeek] ON [OpeningHours] ([LocationId], [DayOfWeek]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_OpeningHours_TenantId_LocationId] ON [OpeningHours] ([TenantId], [LocationId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_OutboxMessages_ProcessedAt_NextAttemptAt] ON [OutboxMessages] ([ProcessedAt], [NextAttemptAt]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE UNIQUE INDEX [IX_PushDevices_Token] ON [PushDevices] ([Token]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_PushDevices_UserId] ON [PushDevices] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_RefreshTokens_FamilyId] ON [RefreshTokens] ([FamilyId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE UNIQUE INDEX [IX_RefreshTokens_TokenHash] ON [RefreshTokens] ([TokenHash]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_RefreshTokens_UserId] ON [RefreshTokens] ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_ShiftPublications_TenantId_LocationId_WeekStart] ON [ShiftPublications] ([TenantId], [LocationId], [WeekStart]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_Shifts_TenantId_EmployeeId_StartUtc] ON [Shifts] ([TenantId], [EmployeeId], [StartUtc]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_Shifts_TenantId_JobRoleId] ON [Shifts] ([TenantId], [JobRoleId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_Shifts_TenantId_LocationId_LocalDate] ON [Shifts] ([TenantId], [LocationId], [LocalDate]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_ShiftSwaps_TenantId_AcceptedByEmployeeId] ON [ShiftSwaps] ([TenantId], [AcceptedByEmployeeId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_ShiftSwaps_TenantId_RequesterEmployeeId] ON [ShiftSwaps] ([TenantId], [RequesterEmployeeId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_ShiftSwaps_TenantId_ShiftId_Status] ON [ShiftSwaps] ([TenantId], [ShiftId], [Status]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_ShiftSwaps_TenantId_Status] ON [ShiftSwaps] ([TenantId], [Status]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_ShiftSwaps_TenantId_TargetEmployeeId] ON [ShiftSwaps] ([TenantId], [TargetEmployeeId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE INDEX [IX_Subscriptions_PlanCode] ON [Subscriptions] ([PlanCode]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Subscriptions_TenantId] ON [Subscriptions] ([TenantId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261012205303_InitialCreate'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261012205303_InitialCreate', N'10.0.12');
END;

COMMIT;
GO

