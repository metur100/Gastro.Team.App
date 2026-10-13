import type { Severity } from '@/types/api'

export function worstSeverity(severities: Severity[]): Severity | null {
  if (severities.includes('Error')) return 'Error'
  if (severities.includes('Warning')) return 'Warning'
  if (severities.includes('Info')) return 'Info'
  return null
}
