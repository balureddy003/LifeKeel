import { test, expect } from '@playwright/test'

/**
 * "Ask AI About This" on an event page hands Keel a scenario-specific
 * question and it auto-sends — the race-condition fix from this session
 * (reading ?prompt= in an effect, not during render) regresses silently
 * and specifically on in-app <Link> navigation, so this clicks the real
 * button rather than hard-navigating to the URL.
 */

async function gotoWithWarmup(page: import('@playwright/test').Page, url: string) {
  await page.goto(url)
  const bodyText = await page.locator('body').innerText()
  if (bodyText.trim() === 'Skip to content') {
    await page.goto(url)
  }
}

test('Ask AI About This auto-sends a scenario-specific prompt via in-app navigation', async ({ page }) => {
  await gotoWithWarmup(page, '/events/car')
  await page.getByText('Ask AI About This').click()

  await expect(page).toHaveURL(/\/assistant\?context=/)
  // The auto-sent user message names the specific scenario, not a blank chat.
  await expect(page.getByText(/Car accident/)).toBeVisible()
  // Keel's reply — a real LLM call, so a generous timeout.
  await expect(page.locator('[role="log"]')).toContainText(/car/i, { timeout: 25_000 })
})

test('a blank /assistant visit shows the generic welcome and does not auto-send', async ({ page }) => {
  await gotoWithWarmup(page, '/assistant')
  await expect(page.getByText("Hi! I'm Keel.")).toBeVisible()
  // Only the one welcome bubble — no auto-sent user message above it.
  await expect(page.locator('[role="log"] > *')).toHaveCount(1)
})
