import { expect, type Page } from '@playwright/test'
import { confirmTestAccount } from './verify'

export const PASSWORD = 'E2E-Passwort-2026!'

export function uniqueEmail(prefix: string) {
  return `e2e-${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@e2e.gastroteam.example`
}

/** Path relative to the app base (works for "/" and "/Gastro.Team.App/" deployments). */
export function app(path: string) {
  return path.replace(/^\//, '')
}

export async function register(page: Page, email: string, first: string, last: string) {
  await page.goto(app('/registrieren'))
  await page.getByLabel('Vorname').fill(first)
  await page.getByLabel('Nachname').fill(last)
  await page.getByLabel('E-Mail-Adresse').fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Passwort wiederholen').fill(PASSWORD)
  await page.getByText('Ich akzeptiere die Nutzungsbedingungen').click()
  await page.getByRole('button', { name: 'Konto erstellen' }).click()

  // Environments with e-mail verification: read the link from the development mailbox.
  const verify = page.getByRole('heading', { name: 'Fast geschafft' })
  const onboarding = page.getByRole('heading', { name: /Erzählen Sie uns von Ihrem Betrieb/ })
  await expect(verify.or(onboarding)).toBeVisible()
  if (await verify.isVisible()) {
    const res = await page.request.get(`${app('/api/v1/dev/emails')}?to=${encodeURIComponent(email)}`)
    const isJson = res.ok() && (res.headers()['content-type'] ?? '').includes('json')
    if (isJson) {
      const mails = (await res.json()) as { subject: string; text: string }[]
      const link = /https?:\/\/\S*email-bestaetigen\S*/.exec(mails.find((m) => m.subject.includes('bestätigen'))!.text)![0]
      await page.goto(link)
      await expect(page.getByText('Ihre E-Mail-Adresse ist bestätigt')).toBeVisible()
    } else {
      // Deployed environment without dev mailbox: confirm the throwaway test account in the database (test tooling only).
      expect(confirmTestAccount(email), 'Cannot verify the test account: set E2E_SQL_* variables or use an environment with the dev mailbox').toBe(true)
    }
    await login(page, email)
    await expect(onboarding).toBeVisible()
  }
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto(app('/anmelden'))
  await page.getByLabel('E-Mail-Adresse').fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page).not.toHaveURL(/anmelden/)
}

export async function createBusiness(page: Page, name: string) {
  await page.getByLabel('Name des Betriebs').fill(name)
  await page.getByRole('button', { name: 'Betrieb anlegen' }).click()
  await expect(page.getByRole('heading', { name: 'Ersten Standort anlegen' })).toBeVisible()
}
