// Mirrors the backend DTOs (shared with the web app types in apps/web/src/types/api.ts).
// Types mirror the backend DTOs (GastroTeam.Application). Dates are ISO strings: DateOnly "yyyy-MM-dd",
// TimeOnly "HH:mm", DateTime UTC ISO-8601.

export type Role = 'Owner' | 'Manager' | 'Employee'
export type Permission = 'ManageEmployees' | 'ManageSchedules' | 'PublishSchedules' | 'ApproveLeave' | 'ManageSwaps' | 'ViewReports'
export type PlanFeature = 'ShiftSwaps' | 'Availability' | 'Reports' | 'EmailNotifications' | 'AdvancedPermissions' | 'MultipleLocations'
export type TenantStatus = 'Active' | 'Suspended'
export type SubscriptionStatus = 'Trial' | 'Active' | 'PastDue' | 'Cancelled' | 'Suspended'
export type EmployeeStatus = 'Invited' | 'Active' | 'Inactive' | 'Archived'
export type ShiftStatus = 'Draft' | 'Published' | 'Cancelled'
export type AvailabilityKind = 'Available' | 'Preferred' | 'Unavailable'
export type LeaveType = 'Vacation' | 'Sick' | 'Unpaid' | 'Training' | 'Other'
export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled'
export type SwapStatus = 'Pending' | 'AwaitingApproval' | 'Completed' | 'Declined' | 'Rejected' | 'Cancelled' | 'Invalidated'
export type Severity = 'Error' | 'Warning' | 'Info'
export type DayOfWeek = 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday'

export interface Paged<T> {
  items: T[]
  page: number
  pageSize: number
  totalCount: number
}

export interface SubscriptionSummary {
  planCode: string
  planName: string
  status: SubscriptionStatus
  trialEndsAt: string | null
  isTestMode: boolean
  features: PlanFeature[]
  canWrite: boolean
}

export interface CurrentTenant {
  id: string
  name: string
  role: Role
  permissions: Permission[]
  managedLocationIds: string[]
  employeeId: string | null
  status: TenantStatus
  onboardingStep: number
  onboardingCompleted: boolean
  subscription: SubscriptionSummary
}

export interface Me {
  id: string
  email: string
  firstName: string
  lastName: string
  emailConfirmed: boolean
  preferredLanguage: string
  isPlatformAdmin: boolean
  memberships: { tenantId: string; tenantName: string; role: Role; tenantStatus: TenantStatus }[]
  currentTenant: CurrentTenant | null
}

export interface OpeningHour {
  dayOfWeek: DayOfWeek
  isClosed: boolean
  opensAt: string
  closesAt: string
}

export interface Location {
  id: string
  name: string
  street: string | null
  postalCode: string | null
  city: string | null
  country: string
  timeZoneId: string
  phone: string | null
  email: string | null
  isActive: boolean
  minStaffPerDay: number
  defaultBreakMinutes: number
  prepBufferMinutes: number
  openingHours: OpeningHour[]
  employeeCount: number
  canManage: boolean
}

export interface JobRole {
  id: string
  name: string
  color: string
  sortOrder: number
  isActive: boolean
}

export interface Employee {
  id: string
  firstName: string
  lastName: string
  fullName: string
  email: string | null
  phone: string | null
  profileImageUrl: string | null
  jobRoleId: string | null
  jobRoleName: string | null
  jobRoleColor: string | null
  status: EmployeeStatus
  contractHoursPerWeek: number | null
  employmentStartDate: string | null
  employmentEndDate: string | null
  preferredLanguage: string
  locationIds: string[]
  hasAccount: boolean
  invitationExpiresAt: string | null
  notes: string | null
  version: string
  createdAt: string
  updatedAt: string
}

export interface InvitationCreated {
  invitationId: string
  email: string
  expiresAt: string
  emailSent: boolean
  link: string | null
}

export interface Shift {
  id: string
  locationId: string
  locationName: string | null
  employeeId: string | null
  employeeName: string | null
  jobRoleId: string
  jobRoleName: string
  jobRoleColor: string
  date: string
  startTime: string
  endTime: string
  endsNextDay: boolean
  startUtc: string
  endUtc: string
  breakMinutes: number
  paidHours: number
  notes: string | null
  status: ShiftStatus
  publishedAt: string | null
  version: string
}

export interface Issue {
  severity: Severity
  code: string
  message: string
  shiftId: string | null
  employeeId: string | null
  date: string | null
}

export interface ShiftSaveResult {
  shift: Shift
  issues: Issue[]
}

export interface WeekEmployee {
  id: string
  fullName: string
  jobRoleId: string | null
  jobRoleName: string | null
  contractHoursPerWeek: number | null
  plannedHours: number
  status: EmployeeStatus
  availability: { dayOfWeek: DayOfWeek; startTime: string; endTime: string; kind: AvailabilityKind }[]
  absences: { date: string; kind: 'leave' | 'leave_pending' | 'unavailable'; label: string }[]
}

export interface WeekView {
  locationId: string
  locationName: string
  timeZoneId: string
  weekStart: string
  days: { date: string; isClosed: boolean; opensAt: string | null; closesAt: string | null }[]
  shifts: Shift[]
  employees: WeekEmployee[]
  issues: Issue[]
  publication: { state: 'empty' | 'draft' | 'partial' | 'published'; draftShifts: number; publishedShifts: number; lastPublishedAt: string | null }
  totalPlannedHours: number
  unassignedShifts: number
}

export interface ValidationReport {
  issues: Issue[]
  errors: number
  warnings: number
  infos: number
}

export interface PublishResult {
  publishedShifts: number
  notifiedEmployees: number
  issues: Issue[]
}

export interface AvailabilitySlot {
  dayOfWeek: DayOfWeek
  startTime: string
  endTime: string
  kind: AvailabilityKind
  note: string | null
}

export interface AvailabilityException {
  id: string
  date: string
  startTime: string | null
  endTime: string | null
  note: string | null
}

export interface Availability {
  employeeId: string
  employeeName: string
  validFrom: string | null
  weekly: AvailabilitySlot[]
  exceptions: AvailabilityException[]
}

export interface AvailabilityOverviewItem {
  employeeId: string
  employeeName: string
  weeklySlots: number
  upcomingExceptions: number
  validFrom: string | null
}

export interface LeaveRequest {
  id: string
  employeeId: string
  employeeName: string
  type: LeaveType
  startDate: string
  endDate: string
  days: number
  note: string | null
  status: LeaveStatus
  decisionReason: string | null
  decidedByName: string | null
  decidedAt: string | null
  createdAt: string
  version: string
  canCancel: boolean
  canDecide: boolean
}

export interface LeaveConflicts {
  shifts: Shift[]
  overlappingRequests: LeaveRequest[]
}

export interface Swap {
  id: string
  shift: Shift
  requesterEmployeeId: string
  requesterName: string
  targetEmployeeId: string | null
  targetName: string | null
  acceptedByEmployeeId: string | null
  acceptedByName: string | null
  status: SwapStatus
  message: string | null
  decisionReason: string | null
  createdAt: string
  completedAt: string | null
  version: string
  canAccept: boolean
  canDecline: boolean
  canApprove: boolean
  canReject: boolean
  canCancel: boolean
}

export interface EligibleColleague {
  id: string
  fullName: string
  jobRoleName: string | null
  hasConflict: boolean
  conflictReason: string | null
}

export interface Notification {
  id: string
  type: string
  title: string
  body: string
  link: string | null
  createdAt: string
  readAt: string | null
}

export interface DashboardSummary {
  today: string
  employeesWorkingToday: number
  shiftsToday: number
  unassignedShifts: number
  pendingLeaveRequests: number
  pendingSwapRequests: number
  scheduledHoursThisWeek: number
  activeEmployees: number
  hasAnyShifts: boolean
}

export interface ActionItem {
  kind: string
  severity: 'warning' | 'info'
  message: string
  link: string
  count: number
}

export interface EmployeeOverview {
  nextShift: Shift | null
  upcomingShifts: Shift[]
  scheduledHoursThisWeek: number
  contractHoursPerWeek: number | null
  pendingLeaveRequests: number
  openSwapOffers: number
  unreadNotifications: number
}

export interface TenantSettings {
  name: string
  contactEmail: string | null
  phone: string | null
  logoUrl: string | null
  defaultLanguage: string
  defaultTimeZone: string
  unassignedShiftsBlockPublish: boolean
  maxShiftHours: number
  maxDailyHours: number
  maxWeeklyHours: number
  minRestHours: number
  checkBreakRules: boolean
  swapRequiresManagerApproval: boolean
  allowOpenSwapOffers: boolean
  employeesSeeColleagueShifts: boolean
  ruleSetVersion: string
}

export interface Member {
  membershipId: string
  userId: string
  fullName: string
  email: string
  role: Role
  permissions: Permission[]
  locationIds: string[]
  isActive: boolean
  employeeId: string | null
}

export interface PendingInvitation {
  id: string
  email: string
  fullName: string
  role: Role
  employeeId: string | null
  expiresAt: string
  createdAt: string
}

export interface Plan {
  code: string
  name: string
  monthlyPriceEur: number
  maxLocations: number
  maxActiveEmployees: number
  features: PlanFeature[]
}

export interface SubscriptionInfo {
  current: SubscriptionSummary
  usage: { activeLocations: number; activeEmployees: number }
  plans: Plan[]
  manualPlanChangeAllowed: boolean
}

export interface OnboardingState {
  step: number
  completed: boolean
  locations: number
  employees: number
  shifts: number
  publishedShifts: number
  openingHoursConfigured: number
}

export interface PublicInvitation {
  tenantName: string
  email: string
  firstName: string
  lastName: string
  role: Role
  accountExists: boolean
  isValid: boolean
}

export interface AuditLogEntry {
  id: string
  createdAt: string
  action: string
  entityType: string
  entityId: string | null
  userName: string | null
  details: string | null
}

export interface TenantAdmin {
  id: string
  name: string
  status: TenantStatus
  suspensionReason: string | null
  planCode: string
  subscriptionStatus: SubscriptionStatus
  trialEndsAt: string | null
  locations: number
  activeEmployees: number
  createdAt: string
}

export interface Colleague {
  id: string
  fullName: string
  jobRoleName: string | null
}

export interface CopyResult {
  createdShifts: number
  skippedAssignments: number
}

export interface DeactivateResult {
  employee: Employee
  unassignedFutureShifts: number
}
