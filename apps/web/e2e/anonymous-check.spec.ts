import { test, expect } from '@playwright/test'

/**
 * The public 60-second readiness check: no account, no email. Runs on every
 * device project — the quiz is one-question-at-a-time on narrow screens and
 * all-at-once from the `sm` breakpoint, so the spec walks whichever layout it
 * finds rather than assuming one.
 */
test.use({ storageState: { cookies: [], origins: [] } })

test('a signed-out visitor can get a readiness score without signing up', async ({ page }) => {
  await page.goto('/readiness')
  await expect(page.getByText('Family Readiness Check').first()).toBeVisible()

  const seeScore = page.getByRole('button', { name: 'See my score' })
  for (let i = 0; i < 8 && !(await seeScore.isVisible()); i++) {
    await fillVisibleFields(page)
    await page.getByRole('button', { name: 'Next' }).click()
  }
  await fillVisibleFields(page)
  await seeScore.click()

  // The result view offers the account step as a choice, never a gate.
  await expect(page.getByRole('link', { name: /Start monitoring for free/ })).toBeVisible()
  await expect(page.getByText('nothing is saved or linked to you')).toBeHidden()
})

async function fillVisibleFields(page: import('@playwright/test').Page) {
  const inputs = page.locator('input:visible')
  const count = await inputs.count()
  for (let i = 0; i < count; i++) {
    await inputs.nth(i).fill('2')
  }
}
