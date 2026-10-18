import { test, expect, type Page } from '@playwright/test'

/**
 * Region-aware native shell. Playwright can't drive the real Capacitor shell,
 * so this injects a fake bridge (window.Capacitor with an in-memory
 * Preferences plugin) and maps the two production app hostnames onto the
 * local dev server, then watches where the shell navigates. What it cannot
 * prove — the real bridge being present after a cross-origin redirect — is
 * checked by hand in the iOS Simulator (see apps/mobile/README.md).
 */
test.use({ storageState: { cookies: [], origins: [] } })

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

const WEB_BASE = process.env['E2E_WEB_BASE'] ?? 'http://localhost:3002'
const UK = 'https://app.lifekeel.co.uk'
const SI = 'https://app.lifekeel.si'

async function asShell(page: Page, opts: { language: string; saved?: 'uk' | 'si' }) {
  await page.addInitScript(
    ({ language, saved }) => {
      Object.defineProperty(navigator, 'language', { get: () => language })
      const key = 'lifekeel_region'
      // Survives navigations like native storage does (sessionStorage is per origin).
      const read = () => localStorage.getItem('__fake_pref_' + key) ?? saved ?? null
      ;(window as unknown as { Capacitor: unknown }).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        Plugins: {
          Preferences: {
            get: async () => ({ value: read() }),
            set: async ({ value }: { value: string }) =>
              localStorage.setItem('__fake_pref_' + key, value),
          },
        },
      }
    },
    { language: opts.language, saved: opts.saved ?? null },
  )
  // Serve both app hostnames from the local dev server.
  for (const origin of [UK, SI]) {
    await page.route(`${origin}/**`, async (route) => {
      const { pathname, search } = new URL(route.request().url())
      try {
        await route.fulfill({
          response: await route.fetch({ url: `${WEB_BASE}${pathname}${search}` }),
        })
      } catch {
        // A dev-overlay request still in flight when the test ends.
        await route.abort().catch(() => {})
      }
    })
  }
}

test('a Slovenian device is sent from the uk start URL to the si app host', async ({ page }) => {
  await asShell(page, { language: 'sl-SI' })
  await page.goto(`${UK}/login`)
  await page.waitForURL(`${SI}/login`)
})

test('a UK device stays on the uk host', async ({ page }) => {
  await asShell(page, { language: 'en-GB' })
  await page.goto(`${UK}/login`)
  await expect(page.getByText('Region: United Kingdom')).toBeVisible()
  expect(page.url()).toBe(`${UK}/login`)
})

test('Change on /login moves a uk user to si', async ({ page }) => {
  await asShell(page, { language: 'en-GB' })
  await page.goto(`${UK}/login`)
  await page.getByRole('button', { name: 'Change' }).click()
  await page.getByRole('button', { name: 'Slovenia' }).click()
  await page.waitForURL(`${SI}/login`)
})
