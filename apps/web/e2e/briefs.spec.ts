import { test, expect } from '@playwright/test'

/**
 * Household briefs — the signed-in page leads with what is changing (four
 * front doors), keeps every catalogue entry reachable under "see every
 * situation", and, with no second adult on the seeded family, explains what
 * to do rather than failing silently.
 */
test('brief page: front doors, full catalogue, and a clear message without a second adult', async ({
  page,
}) => {
  await page.goto('/briefs')
  await expect(page.getByRole('heading', { name: 'Household briefs' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What is changing?' })).toBeVisible()
  await expect(page.getByText('Add the other adult first')).toBeVisible()

  for (const door of [
    'A baby is coming',
    'A job is changing',
    'Someone needs care',
    'A bill or home is changing',
  ])
    await expect(page.getByRole('button', { name: new RegExp(door) })).toBeVisible()

  await page.getByRole('button', { name: /See every situation/ }).click()
  await expect(page.getByText('Money and income')).toBeVisible()
  await expect(page.getByText('Practical handover')).toBeVisible()
  await expect(page.getByText('Children')).toBeVisible()
  await expect(page.getByText('Hours cut, role changed, illness or recovery')).toBeVisible()
  await expect(page.getByText('A bill or joint account in one name')).toBeVisible()
  await expect(page.getByText(/Bereavement/)).toBeVisible()
  // Separation stays out of the catalogue until the safeguarding review.
  await expect(page.getByText(/[Ss]eparation|[Dd]ivorce/)).toHaveCount(0)

  await page.getByPlaceholder(/Search/).fill('rent')
  await expect(page.getByText('Rent rise')).toBeVisible()
  await expect(page.getByText('Pet care')).toHaveCount(0)

  await page.getByRole('button', { name: 'Rent rise' }).click()
  await page.getByRole('button', { name: 'Show me the answer' }).click()
  // Client-side checks name each missing field beside the field itself.
  await expect(page.getByText('Choose the date this happens')).toBeVisible()
  await expect(page.getByText(/Enter what comes in each month/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Add them in Family' })).toBeVisible()
})
