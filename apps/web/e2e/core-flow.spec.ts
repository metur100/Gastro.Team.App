import { expect, test, type Browser, type Page } from '@playwright/test'
import { PASSWORD, app, createBusiness, login, register, uniqueEmail } from './helpers'

/**
 * Core release flow (serial):
 * 1 owner registers and creates a restaurant · 2 creates a location and an employee · 3 plans a schedule ·
 * 4 publishes it · 5 the employee joins and sees the shift · 6 submits leave · 7 manager approves ·
 * 8 a second tenant cannot access the first tenant's data.
 */
test.describe.configure({ mode: 'serial' })

const run = Date.now().toString().slice(-6)
const ownerEmail = uniqueEmail('owner')
const employeeFirst = 'Emil'
const employeeLast = `Test${run}`
const employeeName = `${employeeFirst} ${employeeLast}`
let employeePath = ''
let inviteLink = ''
let ownerPage: Page

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  ownerPage = await (await browser.newContext({ locale: 'de-DE', timezoneId: 'Europe/Berlin', viewport: { width: 1440, height: 900 } })).newPage()
})

test('1–4: owner registers, onboards, plans and publishes a schedule', async () => {
  const page = ownerPage
  await register(page, ownerEmail, 'Olga', 'Owner')
  await createBusiness(page, `E2E Bistro ${run}`)

  // Location
  await page.getByLabel('Name des Standorts').fill('Innenstadt')
  await page.getByLabel('PLZ', { exact: true }).fill('40210')
  await page.getByLabel('Ort', { exact: true }).fill('Düsseldorf')
  await page.getByRole('button', { name: 'Standort anlegen' }).click()

  // Opening hours
  await expect(page.getByRole('heading', { name: /Öffnungszeiten/ })).toBeVisible()
  await page.getByRole('button', { name: 'Speichern und weiter' }).click()

  // Team
  await expect(page.getByRole('heading', { name: 'Ihr Team' })).toBeVisible()
  await page.getByLabel('Vorname').fill(employeeFirst)
  await page.getByLabel('Nachname').fill(employeeLast)
  await page.getByLabel('E-Mail (optional)').fill(uniqueEmail('employee'))
  await page.getByLabel('Rolle').selectOption({ label: 'Service' })
  await page.getByLabel('Std./Woche').fill('20')
  await page.getByRole('button', { name: 'Hinzufügen' }).click()
  await expect(page.getByText(employeeName)).toBeVisible()
  await page.getByRole('button', { name: 'Weiter' }).click()

  // First schedule: Tuesday next week, 11:00–17:00, assigned to the employee
  await expect(page.getByRole('heading', { name: 'Ersten Schichtplan erstellen' })).toBeVisible()
  await page.getByLabel('Tag').selectOption({ index: 1 })
  await page.getByLabel('Rolle').selectOption({ label: 'Service' })
  await page.getByLabel('Mitarbeiter/in').selectOption({ label: employeeName })
  await page.getByRole('button', { name: 'Schicht hinzufügen' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: employeeName })).toBeVisible()
  await page.getByRole('button', { name: 'Schichtplan veröffentlichen' }).click()
  await expect(page.getByText('Schichtplan veröffentlicht')).toBeVisible()
  await page.getByRole('button', { name: 'Weiter' }).click()
  await page.getByRole('button', { name: 'Zum Dashboard' }).click()

  await expect(page.getByRole('heading', { name: `E2E Bistro ${run}` })).toBeVisible()
  await expect(page.getByText('Geplante Stunden')).toBeVisible()
})

test('3b: manager edits the week in the schedule planner', async () => {
  const page = ownerPage
  await page.goto(app('/schichtplan'))
  await page.getByRole('button', { name: 'Nächste Woche' }).click()
  await expect(page.getByRole('button', { name: /Schicht bearbeiten: 11:00–17:00 Uhr/ })).toBeVisible()
  // Add an unassigned draft shift through the dialog and see it in the grid.
  await page.getByRole('button', { name: 'Schicht', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Neue Schicht' })
  await dialog.getByLabel('Beginn').fill('18:00')
  await dialog.getByLabel('Ende').fill('23:00')
  await dialog.getByLabel('Rolle / Station').selectOption({ label: 'Bar' })
  await dialog.getByRole('button', { name: 'Schicht anlegen' }).click()
  await expect(page.getByText(/Schicht angelegt/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Veröffentlichen \(1\)/ })).toBeVisible()
})

test('5: owner invites the employee who joins and sees the published shift', async ({ browser }) => {
  const page = ownerPage
  await page.goto(app('/mitarbeiter'))
  await page.getByRole('button', { name: `Aktionen für ${employeeName}` }).click()
  await page.getByRole('menuitem', { name: 'Zur App einladen' }).click()
  const dialog = page.getByRole('dialog', { name: 'Einladung erstellt' })
  inviteLink = await dialog.getByLabel(/Einladungslink/).inputValue()
  expect(inviteLink).toContain('/einladung/')
  await dialog.getByRole('button', { name: 'Fertig' }).click()

  await page.getByRole('link', { name: employeeName }).click()
  await expect(page.getByRole('heading', { name: new RegExp(employeeName) })).toBeVisible()
  // Keep only the route below the app base (e.g. strip /Gastro.Team.App on GitHub Pages).
  employeePath = `/mitarbeiter/${new URL(page.url()).pathname.split('/').pop()}`

  const employee = await (await browser.newContext({ locale: 'de-DE', timezoneId: 'Europe/Berlin' })).newPage()
  await employee.goto(inviteLink)
  await expect(employee.getByRole('heading', { name: 'Konto erstellen' })).toBeVisible()
  await employee.getByLabel('Passwort', { exact: true }).fill(PASSWORD)
  await employee.getByLabel('Passwort wiederholen').fill(PASSWORD)
  await employee.getByText('Ich akzeptiere die Nutzungsbedingungen').click()
  await employee.getByRole('button', { name: 'Konto erstellen und beitreten' }).click()
  await expect(employee.getByRole('heading', { name: `Hallo ${employeeFirst}` })).toBeVisible()
  await expect(employee.getByText('11:00–17:00 Uhr').first()).toBeVisible()

  await employee.goto(app('/meine-schichten'))
  await expect(employee.getByText('11:00–17:00 Uhr').first()).toBeVisible()
  // Drafts are never visible to employees.
  await expect(employee.getByText('18:00–23:00')).toHaveCount(0)

  // 6: leave request
  await employee.goto(app('/urlaub'))
  await employee.getByRole('button', { name: 'Neuer Antrag' }).click()
  const leave = employee.getByRole('dialog', { name: 'Neuer Antrag' })
  const start = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10)
  const end = new Date(Date.now() + 42 * 864e5).toISOString().slice(0, 10)
  await leave.getByLabel('Von').fill(start)
  await leave.getByLabel('Bis').fill(end)
  await leave.getByLabel(/Notiz/).fill('Familienbesuch')
  await leave.getByRole('button', { name: 'Antrag einreichen' }).click()
  await expect(employee.getByText('Antrag eingereicht')).toBeVisible()
  await expect(employee.getByText('Offen').first()).toBeVisible()
  await employee.context().close()
})

test('7: manager approves the leave request', async () => {
  const page = ownerPage
  await page.goto(app('/urlaub'))
  const row = page.getByRole('listitem').filter({ hasText: employeeName })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Genehmigen' }).click()
  const dialog = page.getByRole('dialog', { name: 'Antrag genehmigen' })
  await expect(dialog.getByText(/Keine Konflikte|geplante Schicht/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Genehmigen' }).click()
  await expect(page.getByText('Antrag genehmigt')).toBeVisible()
  await page.getByLabel('Status').selectOption({ label: 'Genehmigt' })
  await expect(page.getByRole('listitem').filter({ hasText: employeeName }).getByText('Genehmigt', { exact: true })).toBeVisible()
})

test('8: a second tenant cannot access the first tenant’s data', async ({ browser }) => {
  const other = await (await browser.newContext({ locale: 'de-DE', timezoneId: 'Europe/Berlin' })).newPage()
  await register(other, uniqueEmail('other'), 'Otto', 'Other')
  await createBusiness(other, `E2E Fremd ${run}`)
  await other.goto(app(employeePath))
  await expect(other.getByText('Mitarbeiter/in nicht gefunden')).toBeVisible()
  await other.goto(app('/mitarbeiter'))
  await expect(other.getByText(employeeName)).toHaveCount(0)
  await other.context().close()
})

test('login with wrong password shows a German error', async ({ page }) => {
  await page.goto(app('/anmelden'))
  await page.getByLabel('E-Mail-Adresse').fill(ownerEmail)
  await page.getByLabel('Passwort', { exact: true }).fill('falsches-passwort')
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByText('E-Mail-Adresse oder Passwort ist falsch.')).toBeVisible()
  await login(page, ownerEmail)
})
