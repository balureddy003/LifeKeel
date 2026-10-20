import { test, expect, type Page } from '@playwright/test'

/**
 * Passwordless "keep this result" (PRD-203/204): after the score, one email
 * field saves it, with no password. The request endpoint is stubbed so a run
 * never sends real mail (the local .env may hold live email credentials);
 * the API's own tests cover the server side.
 */
test.use({ storageState: { cookies: [], origins: [] } })

async function fillVisibleFields(page: Page) {
  const inputs = page.locator('input:visible')
  const count = await inputs.count()
  for (let i = 0; i < count; i++) await inputs.nth(i).fill('2')
}

async function reachReveal(page: Page) {
  await page.goto('/readiness')
  const seeScore = page.getByRole('button', { name: 'See my score' })
  for (let i = 0; i < 8 && !(await seeScore.isVisible()); i++) {
    await fillVisibleFields(page)
    await page.getByRole('button', { name: 'Next', exact: true }).click()
  }
  await fillVisibleFields(page)
  await seeScore.click()
  await expect(page.getByRole('button', { name: 'Correct my answers' })).toBeVisible()
}

test('saving the anonymous result needs only an email, on every device', async ({ page }) => {
  let requestBody: Record<string, unknown> | null = null
  await page.route('**/auth/magic-link/request', async (route) => {
    requestBody = route.request().postDataJSON()
    await route.fulfill({ status: 202, contentType: 'application/json', body: '{"ok":true}' })
  })

  await reachReveal(page)

  // Trust block sits with the field, marketing consent starts unticked, and
  // there is no password field anywhere in the flow.
  await expect(page.getByText('What we do and don’t do')).toBeVisible()
  await expect(page.getByLabel(/occasional LifeKeel product updates/)).not.toBeChecked()
  await expect(page.locator('input[type="password"]')).toHaveCount(0)

  await page.getByLabel('Email address').fill('visitor@example.com')
  await page.getByRole('button', { name: /Email me a link to keep this/ }).click()
  await expect(page.getByText('Check your email')).toBeVisible()

  expect(requestBody).toMatchObject({ email: 'visitor@example.com', marketing_consent: false })
  expect(requestBody).toHaveProperty('answers.dependents')
})

test('"Correct my answers" reopens the fields with the answers kept', async ({ page }) => {
  await reachReveal(page)
  await page.getByRole('button', { name: 'Correct my answers' }).click()
  await expect(page.getByText('Used only to calculate your score right now')).toBeVisible()
  await expect(page.locator('input:visible').first()).toHaveValue('2')
})

test('the keep-result page never consumes the token on load', async ({ page }) => {
  const verifyCalls: string[] = []
  await page.route('**/auth/magic-link/verify', async (route) => {
    verifyCalls.push(route.request().method())
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: '{"error":"This link or code is invalid or has expired."}',
    })
  })
  await page.goto('/keep-result?token=' + 'a'.repeat(64))
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible()
  expect(verifyCalls).toHaveLength(0)
  expect(page.url()).not.toContain('token=')
})
