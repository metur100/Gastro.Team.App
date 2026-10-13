import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run against a running stack:
 * - local:    E2E_BASE_URL=http://localhost:5300 (Vite dev server proxying to the local API)
 * - deployed: E2E_BASE_URL=https://metur100.github.io/GastroTeam
 * Tests create their own uniquely named tenants and never touch demo or customer data.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // Trailing slash so relative paths resolve below a sub-path deployment (e.g. /GastroTeam/).
    baseURL: (process.env.E2E_BASE_URL ?? 'http://localhost:5300').replace(/\/?$/, '/'),
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile.spec.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
})
