// End-to-end API workflow check against any environment (e.g. production) without demo data.
// Creates throwaway tenants/users with @e2e.gastroteam.example addresses.
// Requires an environment where e-mail verification is disabled OR uses invitation links returned to the inviter.
// Usage: node scripts/api-flow-check.mjs https://gastroteam.runasp.net
const base = (process.argv[2] ?? 'http://localhost:5191').replace(/\/$/, '') + '/api/v1'
const run = Date.now()
const PASSWORD = `Check-${run}-Passwort!`
let failures = 0

function client() {
  const c = { token: null, tenant: null }
  c.call = async (method, path, body, expected) => {
    const headers = { 'Content-Type': 'application/json', 'X-Client': 'mobile' }
    if (c.token) headers.Authorization = `Bearer ${c.token}`
    if (c.tenant) headers['X-Tenant-Id'] = c.tenant
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    const json = text ? JSON.parse(text) : null
    const ok = expected ? res.status === expected : res.ok
    console.log(`${ok ? 'PASS' : 'FAIL'} ${method} ${path.split('?')[0]} -> ${res.status}${ok ? '' : ' ' + text.slice(0, 240)}`)
    if (!ok) failures++
    return json
  }
  c.login = async (email) => {
    const t = await c.call('POST', '/auth/login', { email, password: PASSWORD })
    c.token = t?.accessToken
    return t
  }
  return c
}

function nextTuesday(weeks = 2) {
  const d = new Date()
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 7 * weeks + 1)
  return d.toISOString().slice(0, 10)
}

const owner = client()
const ownerEmail = `e2e-api-owner-${run}@e2e.gastroteam.example`
const reg = await owner.call('POST', '/auth/register', { email: ownerEmail, password: PASSWORD, firstName: 'Api', lastName: 'Check', acceptTerms: true }, 201)
if (reg?.requiresEmailVerification) {
  console.log('This environment requires e-mail verification; use the Playwright suite with the dev mailbox instead.')
  process.exit(2)
}
await owner.login(ownerEmail)
const business = await owner.call('POST', '/onboarding/business', { name: `E2E API Check ${run}`, timeZone: 'Europe/Berlin' }, 201)
owner.tenant = business.tenantId
const location = await owner.call('POST', '/locations', { name: 'Testort', timeZoneId: 'Europe/Berlin', isActive: true, minStaffPerDay: 0, defaultBreakMinutes: 30, prepBufferMinutes: 120 }, 201)
const roles = await owner.call('GET', '/job-roles')
const empEmail = `e2e-api-emp-${run}@e2e.gastroteam.example`
const employee = await owner.call('POST', '/employees', { firstName: 'Emma', lastName: 'Check', email: empEmail, jobRoleId: roles[0].id, contractHoursPerWeek: 20, locationIds: [location.id], sendInvitation: false }, 201)
const invite = await owner.call('POST', `/employees/${employee.id}/invite`)
const token = invite.link.split('/einladung/')[1]
const anon = client()
await anon.call('POST', '/invitations/lookup', { token })
await anon.call('POST', '/invitations/accept', { token, firstName: 'Emma', lastName: 'Check', password: PASSWORD, acceptTerms: true })

const day = nextTuesday()
const created = await owner.call('POST', '/shifts', { locationId: location.id, jobRoleId: roles[0].id, employeeId: employee.id, date: day, startTime: '11:00', endTime: '17:00', breakMinutes: 30 }, 201)
await owner.call('PUT', `/shifts/${created.shift.id}`, { locationId: location.id, jobRoleId: roles[0].id, employeeId: employee.id, date: day, startTime: '11:00', endTime: '17:00', breakMinutes: 30, version: 'AAAAAAAAAAA=' }, 409)
await owner.call('GET', `/schedules/validation?locationId=${location.id}&date=${day}`)
const pub = await owner.call('POST', '/schedules/publish', { locationId: location.id, weekStart: day, acknowledgeWarnings: true })
console.log(`  published ${pub?.publishedShifts} shift(s), notified ${pub?.notifiedEmployees}`)

const emp = client()
await emp.login(empEmail)
const mine = await emp.call('GET', `/shifts/mine?from=${day}&to=${day}`)
if (mine?.length !== 1) { console.log('FAIL employee should see exactly one published shift'); failures++ } else console.log('PASS employee sees the published shift')
await emp.call('GET', '/employees', undefined, 403)
const leaveDay = nextTuesday(6)
const leave = await emp.call('POST', '/leave-requests', { type: 'Vacation', startDate: leaveDay, endDate: leaveDay, note: 'API-Check' }, 201)
await emp.call('POST', `/leave-requests/${leave.id}/approve`, { version: leave.version }, 403)
await owner.call('GET', `/leave-requests/${leave.id}/conflicts`)
const approved = await owner.call('POST', `/leave-requests/${leave.id}/approve`, { version: leave.version })
if (approved?.status !== 'Approved') failures++
const notes = await emp.call('GET', '/notifications')
console.log(`  employee notifications: ${notes?.items?.map((n) => n.type).join(', ')}`)
await owner.call('GET', `/reports/scheduled-hours?from=${day}&to=${day}`)

// Tenant isolation
const other = client()
const otherEmail = `e2e-api-other-${run}@e2e.gastroteam.example`
await other.call('POST', '/auth/register', { email: otherEmail, password: PASSWORD, firstName: 'Fremd', lastName: 'Check', acceptTerms: true }, 201)
await other.login(otherEmail)
const otherBusiness = await other.call('POST', '/onboarding/business', { name: `E2E Fremd ${run}`, timeZone: 'Europe/Berlin' }, 201)
other.tenant = otherBusiness.tenantId
await other.call('GET', `/employees/${employee.id}`, undefined, 404)
await other.call('GET', `/shifts/${created.shift.id}`, undefined, 404)
other.tenant = business.tenantId
await other.call('GET', '/employees', undefined, 403)

console.log(failures === 0 ? '\nAPI FLOW CHECK PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
