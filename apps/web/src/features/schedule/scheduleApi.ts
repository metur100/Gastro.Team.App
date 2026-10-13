import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError, api, errorMessage } from '@/lib/api'
import type { Issue, Shift, ShiftSaveResult, WeekView } from '@/types/api'

export const weekKey = (locationId: string | null, weekStart: string) => ['week', locationId, weekStart] as const

export function useWeek(locationId: string | null, weekStart: string) {
  return useQuery({
    queryKey: weekKey(locationId, weekStart),
    queryFn: ({ signal }) => api.get<WeekView>(`/schedules/week?locationId=${locationId}&date=${weekStart}`, signal),
    enabled: Boolean(locationId),
    placeholderData: (prev) => (prev?.locationId === locationId ? prev : undefined),
  })
}

export interface ShiftInput {
  locationId: string
  jobRoleId: string
  employeeId: string | null
  date: string
  startTime: string
  endTime: string
  breakMinutes: number
  notes: string | null
}

export function toInput(s: Shift): ShiftInput {
  return {
    locationId: s.locationId,
    jobRoleId: s.jobRoleId,
    employeeId: s.employeeId,
    date: s.date,
    startTime: s.startTime,
    endTime: s.endTime,
    breakMinutes: s.breakMinutes,
    notes: s.notes,
  }
}

/** Shows the most relevant validation feedback after a save. */
export function reportIssues(issues: Issue[], successMessage: string) {
  const errors = issues.filter((i) => i.severity === 'Error')
  const warnings = issues.filter((i) => i.severity === 'Warning')
  if (errors.length > 0) toast.error(`${successMessage} – ${errors[0]!.message}`, { description: errors.length > 1 ? `und ${errors.length - 1} weitere Fehler` : undefined })
  else if (warnings.length > 0) toast.warning(`${successMessage} – Hinweis: ${warnings[0]!.message}`)
  else toast.success(successMessage)
}

/**
 * Moves a shift to another employee/date with an optimistic update. On rejection the
 * previous state is restored and the reason is shown.
 */
export function useMoveShift(locationId: string | null, weekStart: string) {
  const qc = useQueryClient()
  return async (shift: Shift, target: { employeeId: string | null; date: string; jobRoleId?: string }) => {
    if (shift.employeeId === target.employeeId && shift.date === target.date && (target.jobRoleId ?? shift.jobRoleId) === shift.jobRoleId) return
    const key = weekKey(locationId, weekStart)
    const previous = qc.getQueryData<WeekView>(key)
    if (previous) {
      qc.setQueryData<WeekView>(key, {
        ...previous,
        shifts: previous.shifts.map((s) =>
          s.id === shift.id
            ? { ...s, employeeId: target.employeeId, date: target.date, jobRoleId: target.jobRoleId ?? s.jobRoleId, employeeName: previous.employees.find((e) => e.id === target.employeeId)?.fullName ?? null }
            : s,
        ),
      })
    }
    try {
      const result = await api.put<ShiftSaveResult>(`/shifts/${shift.id}`, {
        ...toInput(shift),
        employeeId: target.employeeId,
        date: target.date,
        jobRoleId: target.jobRoleId ?? shift.jobRoleId,
        version: shift.version,
      })
      reportIssues(result.issues, 'Schicht verschoben')
    } catch (e) {
      if (previous) qc.setQueryData(key, previous)
      if (e instanceof ApiError && e.code === 'concurrency_conflict') toast.error(e.message, { duration: 8000 })
      else toast.error(`Verschieben nicht möglich: ${errorMessage(e)}`)
    } finally {
      await qc.invalidateQueries({ queryKey: ['week', locationId] })
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
    }
  }
}
