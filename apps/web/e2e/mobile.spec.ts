import { expect, test } from '@playwright/test'
import { app, createBusiness, register, uniqueEmail } from './helpers'

test('mobile: navigation drawer, no horizontal overflow, schedule agenda view', async ({ page }) => {
  await register(page, uniqueEmail('mobile'), 'Mona', 'Mobil')
  await createBusiness(page, `E2E Mobil ${Date.now().toString().slice(-6)}`)
  await page.getByLabel('Name des Standorts').fill('Mitte')
  await page.getByRole('button', { name: 'Standort anlegen' }).click()
  await expect(page.getByRole('heading', { name: /Öffnungszeiten/ })).toBeVisible()
  await page.getByRole('button', { name: 'Später fortsetzen' }).click()

  for (const path of ['/', '/schichtplan', '/mitarbeiter', '/urlaub', '/einstellungen']) {
    await page.goto(app(path))
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    expect(overflow, `horizontal overflow on ${path}`).toBe(false)
  }

  await page.goto(app('/schichtplan'))
  await expect(page.getByRole('tablist', { name: 'Tag wählen' })).toBeVisible()
  await page.getByRole('button', { name: 'Navigation öffnen' }).click()
  await page.getByRole('link', { name: 'Mitarbeiter' }).click()
  await expect(page.getByRole('heading', { name: 'Mitarbeiter' })).toBeVisible()
})
