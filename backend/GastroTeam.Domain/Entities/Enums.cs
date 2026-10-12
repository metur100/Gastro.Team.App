namespace GastroTeam.Domain.Entities;

public enum TenantStatus { Active = 0, Suspended = 1 }

public enum MembershipRole { Owner = 0, Manager = 1, Employee = 2 }

[Flags]
public enum ManagerPermissions
{
    None = 0,
    ManageEmployees = 1,
    ManageSchedules = 2,
    PublishSchedules = 4,
    ApproveLeave = 8,
    ManageSwaps = 16,
    ViewReports = 32,
    All = ManageEmployees | ManageSchedules | PublishSchedules | ApproveLeave | ManageSwaps | ViewReports
}

public enum EmployeeStatus { Invited = 0, Active = 1, Inactive = 2, Archived = 3 }

public enum ShiftStatus { Draft = 0, Published = 1, Cancelled = 2 }

public enum AvailabilityKind { Available = 0, Preferred = 1, Unavailable = 2 }

public enum LeaveType { Vacation = 0, Sick = 1, Unpaid = 2, Training = 3, Other = 4 }

public enum LeaveStatus { Pending = 0, Approved = 1, Rejected = 2, Cancelled = 3 }

public enum SwapStatus
{
    /// <summary>Waiting for a colleague to accept (or for anyone eligible if it is an open offer).</summary>
    Pending = 0,
    /// <summary>A colleague accepted; waiting for manager approval.</summary>
    AwaitingApproval = 1,
    /// <summary>Swap applied to the shift.</summary>
    Completed = 2,
    Declined = 3,
    Rejected = 4,
    Cancelled = 5,
    /// <summary>The shift changed in a way that makes the request obsolete.</summary>
    Invalidated = 6
}

public enum SubscriptionStatus { Trial = 0, Active = 1, PastDue = 2, Cancelled = 3, Suspended = 4 }

[Flags]
public enum PlanFeatures
{
    None = 0,
    ShiftSwaps = 1,
    Availability = 2,
    Reports = 4,
    EmailNotifications = 8,
    AdvancedPermissions = 16,
    MultipleLocations = 32
}

public enum PublicationAction { Published = 0, Unpublished = 1 }
