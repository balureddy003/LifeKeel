import { test, expect } from '@playwright/test'

/**
 * Household briefs catalogue — the signed-in page renders the grouped
 * catalogue and, with no second adult on the seeded family, refuses
 * creation with a useful message rather than failing silently.
 */
test('brief catalogue renders and requires a second adult', async ({ page }) => {
  await page.goto('/briefs')
  await expect(page.getByRole('heading', { name: 'Household briefs' })).toBeVisible()
  await expect(page.getByText('Money and income')).toBeVisible()
  await expect(page.getByText('Practical handover')).toBeVisible()
  await expect(page.getByText('Children')).toBeVisible()
  await expect(page.getByText('One of us might stop earning')).toBeVisible()
  await expect(page.getByText('Home emergency')).toBeVisible()

  await page.getByRole('button', { name: 'One of us might stop earning' }).click()
  await page.getByRole('button', { name: 'Create the brief' }).click()
  await expect(page.getByText(/Choose another active adult|Invite them from Family/i)).toBeVisible()
})
