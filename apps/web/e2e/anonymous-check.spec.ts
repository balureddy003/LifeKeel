import { test, expect } from '@playwright/test'

/**
 * The public readiness quiz was retired: its URL stays alive for old links and shares, and
 * sends a signed-out visitor to signup with their utm_* parameters intact.
 */
test.use({ storageState: { cookies: [], origins: [] } })

test('the retired readiness check sends a visitor to signup and keeps utm parameters', async ({ page }) => {
  await page.goto('/readiness?utm_source=guides&utm_content=life-insurance&other=1')
  await page.waitForURL(/\/signup\?/)
  const url = new URL(page.url())
  expect(url.pathname).toBe('/signup')
  expect(url.searchParams.get('utm_source')).toBe('guides')
  expect(url.searchParams.get('utm_content')).toBe('life-insurance')
  expect(url.searchParams.has('other')).toBe(false)
})
