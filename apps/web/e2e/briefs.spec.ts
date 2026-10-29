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
  // Review-gap entries — illness/recovery retitle + the added use cases.
  await expect(page.getByText('Hours cut, role changed, illness or recovery')).toBeVisible()
  await expect(page.getByText('A bill or joint account in one name')).toBeVisible()
  await expect(page.getByText(/Bereavement/)).toBeVisible()
  await expect(page.getByText('Energy or council tax rise')).toBeVisible()
  await expect(page.getByText('Car or essential repair bill')).toBeVisible()
  // Separation stays out of the catalogue until the safeguarding review.
  await expect(page.getByText(/[Ss]eparation|[Dd]ivorce/)).toHaveCount(0)

  await page.getByRole('button', { name: 'One of us might stop earning' }).click()
  await page.getByRole('button', { name: 'Create the brief' }).click()
  await expect(page.getByText(/Choose another active adult|Invite them from Family/i)).toBeVisible()
})
