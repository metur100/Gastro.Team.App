import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { LoginForm } from '@/components/LoginForm'
import { LeaveForm, validateLeave } from '@/components/LeaveForm'
import { AvailabilityEditor, toRows, toSlots, type DayRow } from '@/components/AvailabilityEditor'
import { ShiftAgenda } from '@/components/ShiftAgenda'
import { addDaysTo, parseGermanDate, todayString } from '@/lib/format'
import type { Shift } from '@/types/api'

jest.mock('@expo/vector-icons', () => ({ Ionicons: Object.assign(() => null, { glyphMap: {} }) }))

const toGerman = (iso: string) => iso.split('-').reverse().join('.')

describe('LoginForm', () => {
  it('shows validation messages and does not submit invalid input', async () => {
    const submit = jest.fn()
    await render(<LoginForm onSubmit={submit} />)
    await fireEvent.press(screen.getByRole('button', { name: 'Anmelden' }))
    expect(await screen.findByText('Bitte geben Sie eine gültige E-Mail-Adresse an.')).toBeTruthy()
    expect(screen.getByText('Bitte geben Sie Ihr Passwort ein.')).toBeTruthy()
    expect(submit).not.toHaveBeenCalled()
  })

  it('submits trimmed credentials and shows server errors', async () => {
    const submit = jest.fn().mockRejectedValueOnce(Object.assign(new Error('E-Mail-Adresse oder Passwort ist falsch.'), { name: 'ApiError' }))
    await render(<LoginForm onSubmit={submit} />)
    await fireEvent.changeText(screen.getByLabelText('E-Mail-Adresse'), '  mia@test.example ')
    await fireEvent.changeText(screen.getByLabelText('Passwort'), 'geheim-passwort')
    await fireEvent.press(screen.getByRole('button', { name: 'Anmelden' }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith('mia@test.example', 'geheim-passwort'))
    expect(await screen.findByText(/unerwarteter Fehler|Passwort ist falsch/)).toBeTruthy()
  })
})

describe('Leave request validation', () => {
  const start = addDaysTo(todayString(), 10)
  it('rejects end before start and invalid dates', async () => {
    expect(validateLeave('Vacation', toGerman(start), toGerman(addDaysTo(start, -1)), '').errors.end).toMatch(/Enddatum/)
    expect(validateLeave('Vacation', '31.02.2026', toGerman(start), '').errors.start).toMatch(/TT\.MM\.JJJJ/)
  })
  it('rejects past vacation but allows past sick leave', async () => {
    const past = toGerman(addDaysTo(todayString(), -2))
    expect(validateLeave('Vacation', past, past, '').errors.start).toMatch(/rückwirkend/)
    expect(validateLeave('Sick', past, past, '').value?.type).toBe('Sick')
  })
  it('submits ISO dates from the form', async () => {
    const submit = jest.fn().mockResolvedValue(undefined)
    await render(<LeaveForm onSubmit={submit} />)
    await fireEvent.changeText(screen.getByLabelText('Von'), toGerman(start))
    await fireEvent.changeText(screen.getByLabelText('Bis'), toGerman(addDaysTo(start, 2)))
    await fireEvent.press(screen.getByRole('button', { name: 'Antrag einreichen' }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ type: 'Vacation', startDate: start, endDate: addDaysTo(start, 2), note: null }))
  })
  it('parses German dates strictly', async () => {
    expect(parseGermanDate('1.3.2027')).toBe('2027-03-01')
    expect(parseGermanDate('2027-03-01')).toBeNull()
  })
})

describe('AvailabilityEditor', () => {
  it('toggles a day and produces slots for the API', async () => {
    let rows: DayRow[] = toRows([])
    const { rerender } = await render(<AvailabilityEditor rows={rows} onChange={(r) => (rows = r)} />)
    await fireEvent.press(screen.getByLabelText('Dienstag: Verfügbar'))
    await rerender(<AvailabilityEditor rows={rows} onChange={(r) => (rows = r)} />)
    expect(screen.getByLabelText('Dienstag von')).toBeTruthy()
    const { slots, error } = toSlots(rows)
    expect(error).toBeNull()
    expect(slots).toEqual([{ dayOfWeek: 'Tuesday', kind: 'Available', startTime: '10:00', endTime: '22:00', note: null }])
  })
  it('reports invalid times in German', async () => {
    const rows = toRows([]).map((r) => (r.day === 'Friday' ? { ...r, mode: 'Unavailable' as const, start: '25:00' } : r))
    expect(toSlots(rows).error).toMatch(/Freitag/)
  })
})

describe('ShiftAgenda', () => {
  const shift: Shift = {
    id: 's1', locationId: 'l1', locationName: 'Altstadt', employeeId: 'e1', employeeName: 'Mia', jobRoleId: 'r', jobRoleName: 'Service', jobRoleColor: '#0F766E',
    date: todayString(), startTime: '17:00', endTime: '23:00', endsNextDay: false, startUtc: '', endUtc: '', breakMinutes: 30, paidHours: 5.5, notes: null,
    status: 'Published', publishedAt: null, version: 'v',
  }
  it('groups shifts by day and opens details', async () => {
    const open = jest.fn()
    await render(<ShiftAgenda shifts={[shift]} onOpen={open} />)
    expect(screen.getByText(/· Heute/)).toBeTruthy()
    await fireEvent.press(screen.getByRole('button', { name: /17:00–23:00 Uhr, Service, Altstadt/ }))
    expect(open).toHaveBeenCalledWith(shift)
  })
  it('shows an empty state', async () => {
    await render(<ShiftAgenda shifts={[]} onOpen={jest.fn()} />)
    expect(screen.getByText('Keine Schichten im Zeitraum')).toBeTruthy()
  })
})
