import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Trust-tranche smoke + screenshot pass: exercises the three features from
 * PR #27 against the live dev stack (API running with
 * EMAIL_VERIFICATION_ENABLED=true — global-setup signs up a fresh account,
 * which is exactly the unverified-user case the banner exists for).
 * Screenshots land in /tmp/keel-shots for visual review.
 */

const SHOTS = '/tmp/keel-shots'

async function gotoWithWarmup(page: import('@playwright/test').Page, url: string) {
  await page.goto(url)
  const bodyText = await page.locator('body').innerText()
  if (bodyText.trim() === 'Skip to content') await page.goto(url)
}

test.beforeAll(() => fs.mkdirSync(SHOTS, { recursive: true }))

test('unverified user sees the verify-email banner and can resend', async ({ page }) => {
  await gotoWithWarmup(page, '/')
  const banner = page.getByText('Verify your email so invites and recovery reach you')
  await expect(banner).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: `${SHOTS}/01-home-verify-banner.png` })

  await page.getByRole('button', { name: 'Resend link' }).click()
  await expect(page.getByText('Verification link sent — check your inbox')).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: `${SHOTS}/02-banner-resend-sent.png` })
})

test('assistant renders an answer state — never a silent failure', async ({ page }) => {
  test.setTimeout(90_000)
  await gotoWithWarmup(page, '/assistant')
  await page.screenshot({ path: `${SHOTS}/03-assistant-landing.png` })

  const input = page.locator('input.glass-input').first()
  await expect(input).toBeVisible({ timeout: 15_000 })
  await input.fill('What happens if I lose my job?')

  // Wait on the actual ask response, then let the card settle — live,
  // canned, and unavailable are all honest outcomes; a silent hang isn't.
  const askResponse = page.waitForResponse(
    (r) => r.url().includes('/assistant/ask'),
    { timeout: 60_000 },
  )
  await input.press('Enter')
  const res = await askResponse
  console.log(`[e2e] /assistant/ask → ${res.status()}`)
  await page.waitForTimeout(2_000)
  await page.screenshot({ path: `${SHOTS}/04-assistant-answered.png`, fullPage: true })
})

test('/verify-email handles missing and invalid tokens', async ({ page }) => {
  // No token at all
  await page.goto('/verify-email')
  await expect(page.getByText('This link is missing its verification token')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/05-verify-no-token.png` })

  // Bogus token → the verified-invalid state
  await page.goto('/verify-email?token=deadbeefdeadbeef')
  await expect(page.getByText('Link expired or already used')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Invalid or expired verification token')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/06-verify-bad-token.png` })
})

test('life-event contact step draft shows provenance chips from real data', async ({ page }) => {
  test.setTimeout(90_000)
  const seed = JSON.parse(fs.readFileSync(path.resolve(__dirname, '.auth/seed.json'), 'utf-8')) as { lifeEventId: string }
  await gotoWithWarmup(page, `/life-events/${seed.lifeEventId}`)

  const prepare = page.waitForResponse(
    (r) => r.url().includes('/prepare') && r.request().method() === 'POST',
    { timeout: 60_000 },
  )
  await page.getByText('Draft a message for me').first().click()
  const res = await prepare
  console.log(`[e2e] step prepare → ${res.status()}`)

  // The draft textarea must appear — and provenance should either list
  // grounded facts or honestly warn that none survived into the draft.
  await expect(page.locator('textarea.glass-input').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/From your data|No figures from your family/i)).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: `${SHOTS}/07-life-event-draft.png`, fullPage: true })
})
