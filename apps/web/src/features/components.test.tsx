import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DndContext } from '@dnd-kit/core'
import { MemoryRouter } from 'react-router'
import { ShiftChip } from './schedule/ShiftChip'
import { rowsToSlots, slotsToRows } from './availability/availabilityRows'
import { ErrorState } from '@/components/ui/display'
import { ApiError } from '@/lib/api'
import type { Shift } from '@/types/api'

const shift: Shift = {
  id: 's1', locationId: 'l1', locationName: 'Altstadt', employeeId: null, employeeName: null, jobRoleId: 'r1', jobRoleName: 'Service',
  jobRoleColor: '#0F766E', date: '2026-10-13', startTime: '17:00', endTime: '23:00', endsNextDay: false, startUtc: '2026-10-13T15:00:00Z',
  endUtc: '2026-10-13T21:00:00Z', breakMinutes: 30, paidHours: 5.5, notes: null, status: 'Draft', publishedAt: null, version: 'AAA=',
}

describe('ShiftChip', () => {
  it('communicates status in text, not only colour, and opens on click', async () => {
    const onOpen = vi.fn()
    render(
      <DndContext>
        <ShiftChip shift={shift} severity="Warning" showEmployee draggable onOpen={onOpen} />
      </DndContext>,
    )
    const button = screen.getByRole('button', { name: /Schicht bearbeiten/ })
    expect(button).toHaveAccessibleName(expect.stringContaining('nicht besetzt'))
    expect(button).toHaveAccessibleName(expect.stringContaining('Entwurf'))
    expect(button).toHaveAccessibleName(expect.stringContaining('mit Hinweis'))
    expect(screen.getByText('Nicht besetzt')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Schicht verschieben/ })).toBeInTheDocument()
    await userEvent.click(button)
    expect(onOpen).toHaveBeenCalledWith(shift)
  })

  it('has no drag handle when editing is not allowed', () => {
    render(
      <DndContext>
        <ShiftChip shift={{ ...shift, status: 'Published', employeeId: 'e1', employeeName: 'Mia Schmidt' }} severity={null} showEmployee draggable={false} onOpen={() => {}} />
      </DndContext>,
    )
    expect(screen.queryByRole('button', { name: /verschieben/ })).toBeNull()
    expect(screen.getByText('Mia Schmidt')).toBeInTheDocument()
  })
})

describe('availability conversion', () => {
  it('round-trips weekly slots and drops days without entry', () => {
    const rows = slotsToRows([{ dayOfWeek: 'Tuesday', startTime: '10:00', endTime: '22:00', kind: 'Available', note: null }])
    expect(rows).toHaveLength(7)
    expect(rows[0]!.day).toBe('Monday')
    expect(rows[0]!.mode).toBe('none')
    expect(rows[1]!.mode).toBe('Available')
    expect(rowsToSlots(rows)).toEqual([{ dayOfWeek: 'Tuesday', kind: 'Available', startTime: '10:00', endTime: '22:00', note: null }])
  })
})

describe('ErrorState', () => {
  it('shows permission denied without a retry button', () => {
    render(<MemoryRouter><ErrorState error={new ApiError({ status: 403, title: 'Sie haben keine Berechtigung.' })} onRetry={() => {}} /></MemoryRouter>)
    expect(screen.getByText('Kein Zugriff')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Erneut versuchen/ })).toBeNull()
  })

  it('offers retry for other errors', async () => {
    const retry = vi.fn()
    render(<ErrorState error={new ApiError({ status: 500, title: 'Fehler' })} onRetry={retry} />)
    await userEvent.click(screen.getByRole('button', { name: /Erneut versuchen/ }))
    expect(retry).toHaveBeenCalled()
  })
})
