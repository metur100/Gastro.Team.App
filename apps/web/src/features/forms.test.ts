import { describe, expect, it } from 'vitest'
import { employeeSchema, toRequest } from './employees/employeeSchema'
import { leaveRequestSchema } from './leave/leaveSchema'
import { registerSchema } from './auth/RegisterPage'
import { addDaysTo, fmt, mondayOf, plural, todayString } from '@/lib/format'

const validEmployee = {
  firstName: 'Mia',
  lastName: 'Schmidt',
  email: '',
  phone: '',
  jobRoleId: '',
  contractHoursPerWeek: '',
  employmentStartDate: '',
  employmentEndDate: '',
  preferredLanguage: 'de-DE',
  locationIds: ['loc-1'],
  notes: '',
  sendInvitation: false,
}

const messages = (r: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } }) =>
  Object.fromEntries((r.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]))

describe('employee form', () => {
  it('requires names and at least one location', () => {
    const r = employeeSchema.safeParse({ ...validEmployee, firstName: ' ', lastName: '', locationIds: [] })
    const m = messages(r)
    expect(m.firstName).toMatch(/Vornamen/)
    expect(m.lastName).toMatch(/Nachnamen/)
    expect(m.locationIds).toMatch(/mindestens einen Standort/)
  })

  it('validates email format and requires an email for invitations', () => {
    expect(messages(employeeSchema.safeParse({ ...validEmployee, email: 'kein-email' })).email).toMatch(/gültige E-Mail/)
    expect(messages(employeeSchema.safeParse({ ...validEmployee, sendInvitation: true })).email).toMatch(/Einladung/)
  })

  it('validates hours and date order', () => {
    expect(messages(employeeSchema.safeParse({ ...validEmployee, contractHoursPerWeek: '75' })).contractHoursPerWeek).toBeDefined()
    expect(messages(employeeSchema.safeParse({ ...validEmployee, employmentStartDate: '2026-05-01', employmentEndDate: '2026-04-01' })).employmentEndDate).toMatch(/Austrittsdatum/)
  })

  it('maps German decimal input and empty values to the API request', () => {
    const parsed = employeeSchema.parse({ ...validEmployee, contractHoursPerWeek: '19,5', email: ' mia@test.example ' .trim() })
    const req = toRequest(parsed)
    expect(req.contractHoursPerWeek).toBe(19.5)
    expect(req.jobRoleId).toBeNull()
    expect(req.phone).toBeNull()
  })
})

describe('leave request form', () => {
  const future = addDaysTo(todayString(), 10)

  it('rejects an end date before the start date', () => {
    const r = leaveRequestSchema.safeParse({ type: 'Vacation', startDate: future, endDate: addDaysTo(future, -1), note: '' })
    expect(messages(r).endDate).toMatch(/Enddatum/)
  })

  it('rejects vacation in the past but allows sick leave', () => {
    const past = addDaysTo(todayString(), -3)
    expect(messages(leaveRequestSchema.safeParse({ type: 'Vacation', startDate: past, endDate: past, note: '' })).startDate).toMatch(/rückwirkend/)
    expect(leaveRequestSchema.safeParse({ type: 'Sick', startDate: past, endDate: past, note: '' }).success).toBe(true)
  })
})

describe('registration form', () => {
  it('requires matching passwords of at least 10 characters and accepted terms', () => {
    const m = messages(registerSchema.safeParse({ firstName: 'A', lastName: 'B', email: 'a@b.de', password: 'kurz', passwordRepeat: 'anders', acceptTerms: false }))
    expect(m.password).toMatch(/10 Zeichen/)
    expect(m.acceptTerms).toMatch(/akzeptieren/)
  })
})

describe('German formatting', () => {
  it('formats dates, hours and plurals for de-DE', () => {
    expect(fmt.date('2026-10-12')).toBe('12.10.2026')
    expect(fmt.hours(7.5)).toBe('7,5 Std.')
    expect(fmt.euro(39)).toMatch(/39,00\s€/)
    expect(fmt.week('2026-10-12')).toBe('KW 42 · 12.10.–18.10.2026')
    expect(plural(1, 'Schicht', 'Schichten')).toBe('1 Schicht')
    expect(plural(3, 'Schicht', 'Schichten')).toBe('3 Schichten')
    expect(mondayOf('2026-10-18')).toBe('2026-10-12')
  })
})
