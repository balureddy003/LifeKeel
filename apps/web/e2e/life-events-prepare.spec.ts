import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Life-events prepare extension: every playbook step gets a draft
 * affordance now, not just contact:true ones — a non-contact step gets a
 * prep note ("Get Keel's help with this", copy-only, no send path); a
 * contact step keeps the original outreach-email draft ("Draft a message
 * for me", copy + mailto). global-setup.ts seeds one job_loss event, which
 * has both kinds of step.
 */

async function gotoWithWarmup(page: import('@playwright/test').Page, url: string) {
  await page.goto(url)
  const bodyText = await page.locator('body').innerText()
  if (bodyText.trim() === 'Skip to content') {
    await page.goto(url)
  }
}

function seededLifeEventId(): string {
  const seed = JSON.parse(fs.readFileSync(path.resolve(__dirname, '.auth/seed.json'), 'utf-8')) as { lifeEventId: string }
  return seed.lifeEventId
}

test('a non-contact step generates a prep note, not an outreach email', async ({ page }) => {
  await gotoWithWarmup(page, `/life-events/${seededLifeEventId()}`)
  await expect(page.getByText('Calculate your runway')).toBeVisible()

  const prepButtons = page.getByText("Get Keel's help with this")
  await expect(prepButtons.first()).toBeVisible()
  await prepButtons.first().click()

  await expect(page.getByText(/Keel hasn't checked, filed, or contacted anyone for you/)).toBeVisible({ timeout: 25_000 })
  // Copy-only — never a mailto/send affordance for a non-contact step.
  await expect(page.getByText('Open in email')).toHaveCount(0)
})

test('a contact step still generates the original outreach-email draft', async ({ page }) => {
  await gotoWithWarmup(page, `/life-events/${seededLifeEventId()}`)
  await expect(page.getByText('Contact your mortgage lender')).toBeVisible()

  await page.getByText('Draft a message for me').click()

  await expect(page.getByText(/Keel never sends it for you/)).toBeVisible({ timeout: 25_000 })
  await expect(page.getByText('Open in email')).toBeVisible()
})
