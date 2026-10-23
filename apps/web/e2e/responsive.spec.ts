import { test, expect } from '@playwright/test'

/**
 * Layout sanity on every device project: key routes must not scroll sideways.
 * Horizontal overflow on a phone or iPad is the most common "works on desktop
 * only" bug and is cheap to catch.
 */
const ROUTES = [
  '/',
  '/readiness',
  '/events',
  '/settings',
  '/upload',
  '/legal',
  '/legal/gdpr',
  '/terms',
  '/privacy',
  '/cookies',
  '/security',
  '/guides/',
  '/guides/emergency-fund-how-much/',
]

for (const route of ROUTES) {
  test(`${route} has no horizontal overflow`, async ({ page }) => {
    await page.goto(route)
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `${route} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1)
  })
}
