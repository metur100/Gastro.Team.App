// Central German UI labels for enum values. Keep wording consistent across screens.
import type { AvailabilityKind, EmployeeStatus, LeaveStatus, LeaveType, Permission, Role, ShiftStatus, SubscriptionStatus, SwapStatus } from '@/types/api'

export const roleLabel: Record<Role, string> = { Owner: 'Inhaber/in', Manager: 'Leitung', Employee: 'Mitarbeiter/in' }

export const permissionLabel: Record<Permission, string> = {
  ManageEmployees: 'Mitarbeiter verwalten',
  ManageSchedules: 'Schichtplan bearbeiten',
  PublishSchedules: 'Schichtplan veröffentlichen',
  ApproveLeave: 'Urlaubsanträge genehmigen',
  ManageSwaps: 'Schichttausch freigeben',
  ViewReports: 'Auswertungen ansehen',
}

export const employeeStatusLabel: Record<EmployeeStatus, string> = {
  Invited: 'Eingeladen',
  Active: 'Aktiv',
  Inactive: 'Inaktiv',
  Archived: 'Archiviert',
}

export const shiftStatusLabel: Record<ShiftStatus, string> = {
  Draft: 'Entwurf',
  Published: 'Veröffentlicht',
  Cancelled: 'Abgesagt',
}

export const leaveTypeLabel: Record<LeaveType, string> = {
  Vacation: 'Urlaub',
  Sick: 'Krankmeldung',
  Unpaid: 'Unbezahlter Urlaub',
  Training: 'Fortbildung',
  Other: 'Sonstige Abwesenheit',
}

export const leaveStatusLabel: Record<LeaveStatus, string> = {
  Pending: 'Offen',
  Approved: 'Genehmigt',
  Rejected: 'Abgelehnt',
  Cancelled: 'Storniert',
}

export const swapStatusLabel: Record<SwapStatus, string> = {
  Pending: 'Wartet auf Antwort',
  AwaitingApproval: 'Wartet auf Freigabe',
  Completed: 'Abgeschlossen',
  Declined: 'Abgelehnt (Kollege)',
  Rejected: 'Abgelehnt (Leitung)',
  Cancelled: 'Zurückgezogen',
  Invalidated: 'Hinfällig',
}

export const availabilityKindLabel: Record<AvailabilityKind, string> = {
  Available: 'Verfügbar',
  Preferred: 'Bevorzugt',
  Unavailable: 'Nicht verfügbar',
}

export const subscriptionStatusLabel: Record<SubscriptionStatus, string> = {
  Trial: 'Testphase',
  Active: 'Aktiv',
  PastDue: 'Zahlung überfällig',
  Cancelled: 'Gekündigt',
  Suspended: 'Gesperrt',
}

export const TIME_ZONES = ['Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich', 'Europe/Sarajevo', 'Europe/Zagreb', 'Europe/Belgrade']
