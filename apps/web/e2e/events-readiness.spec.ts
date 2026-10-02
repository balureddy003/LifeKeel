import { test, expect } from '@playwright/test'

/**
 * /events "What If?" scenarios: a type with no matching policy stays on the
 * static sample; a type with one (seeded in global-setup.ts: a car policy
 * with Direct Line) flips to real, live-computed data.
 */

// Next dev's on-demand compile can 404 a route's chunks on its very first
// visit this run — reload once rather than treat that as a failure.
async function gotoWithWarmup(page: import('@playwright/test').Page, url: string) {
  await page.goto(url)
  const bodyText = await page.locator('body').innerText()
  if (bodyText.trim() === 'Skip to content') {
    await page.goto(url)
  }
}

test('a policy-less event type shows the static sample scenario', async ({ page }) => {
  await gotoWithWarmup(page, '/events/property')
  await expect(page.getByText('Sample scenario — connect your data for a real one')).toBeVisible()
})

test('a seeded car policy flips /events/car to real, live-computed data', async ({ page }) => {
  await gotoWithWarmup(page, '/events/car')
  await expect(page.getByText("Based on your family's data")).toBeVisible()
  await expect(page.getByText(/Direct Line/)).toBeVisible()
  // Real formula: policyPresenceReadiness returns a flat 92 when a matching
  // policy exists — asserting the exact number catches a regression in the
  // backend computation, not just "some real-looking text appeared".
  await expect(page.getByText('92%')).toBeVisible()
})
