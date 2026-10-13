import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError, api, errorMessage } from './api'
import { useAuth } from './auth'
import type { Colleague, Employee, JobRole, Paged } from '@/types/api'

export function useJobRoles() {
  const { me } = useAuth()
  return useQuery({
    queryKey: ['job-roles'],
    queryFn: () => api.get<JobRole[]>('/job-roles'),
    enabled: Boolean(me?.currentTenant),
    staleTime: 5 * 60_000,
  })
}

/** Active employees of a location (manager scope). */
export function useLocationEmployees(locationId: string | null) {
  return useQuery({
    queryKey: ['employees', 'location', locationId],
    queryFn: () => api.get<Paged<Employee>>(`/employees?locationId=${locationId}&status=Active&pageSize=200`),
    enabled: Boolean(locationId),
    select: (d) => d.items,
  })
}

export function useColleagues(locationId?: string | null) {
  return useQuery({
    queryKey: ['colleagues', locationId ?? 'all'],
    queryFn: () => api.get<Colleague[]>(`/employees/colleagues${locationId ? `?locationId=${locationId}` : ''}`),
  })
}

interface ActionOptions<TVars, TResult> {
  fn: (vars: TVars) => Promise<TResult>
  success?: string | ((result: TResult) => string)
  invalidate?: QueryKey[]
  onSuccess?: (result: TResult, vars: TVars) => void
  /** Return true when the error was handled (e.g. shown inline) to suppress the toast. */
  onError?: (error: unknown) => boolean | void
}

/** Mutation with consistent success/error feedback and cache invalidation. */
export function useAction<TVars = void, TResult = unknown>({ fn, success, invalidate = [], onSuccess, onError }: ActionOptions<TVars, TResult>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result, vars) => {
      await Promise.all(invalidate.map((key) => qc.invalidateQueries({ queryKey: key })))
      if (success) toast.success(typeof success === 'function' ? success(result) : success)
      onSuccess?.(result, vars)
    },
    onError: (error) => {
      if (onError?.(error)) return
      if (error instanceof ApiError && error.code === 'concurrency_conflict') {
        toast.error(error.message, { duration: 8000 })
        invalidate.forEach((key) => void qc.invalidateQueries({ queryKey: key }))
        return
      }
      toast.error(errorMessage(error))
    },
  })
}

/** Applies server-side validation errors to react-hook-form fields; returns true if any were applied. */
export function applyServerErrors(error: unknown, setError: (name: never, e: { message: string }) => void): boolean {
  if (!(error instanceof ApiError) || !error.errors) return false
  let applied = false
  for (const [field, messages] of Object.entries(error.errors)) {
    if (messages[0]) {
      setError(field as never, { message: messages[0] })
      applied = true
    }
  }
  return applied
}
