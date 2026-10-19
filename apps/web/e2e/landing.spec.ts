import { test, expect, type Page } from '@playwright/test'

/**
 * The public landing page (PRD-209) at desktop and phone widths, light and dark.
 * Anonymous: it clears the signed-in storage state the rest of the suite uses.
 *
 * Run locally against a dev server:  pnpm --filter @lifekeel/web exec playwright test landing
 * CI does not run Playwright; the unit tests and the landing size gate cover CI.
 */
test.use({ storageState: { cookies: [], origins: [] } })

/** The app shows a skeleton until the auth check settles, so wait for the hero before asserting. */
async function openLanding(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('chart')
}

const SIZES = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
] as const
const SCHEMES = ['light', 'dark'] as const

for (const size of SIZES) {
  for (const scheme of SCHEMES) {
    test.describe(`${size.name} ${scheme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme })

      test('first screen shows the headline and a signup link, with no sideways scroll', async ({
        page,
      }) => {
        const errors: string[] = []
        page.on('pageerror', (e) => errors.push(e.message))
        await page.goto('/')
        await expect(page.getByRole('heading', { level: 1 })).toContainText('chart')

        const signup = page.getByRole('link', { name: 'Create your free account' }).first()
        await expect(signup).toBeVisible()
        await expect(signup).toHaveAttribute('href', /\/signup$/)
        const box = (await signup.boundingBox())!
        expect(box.y + box.height).toBeLessThanOrEqual(size.height)

        const widths = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth,
          view: window.innerWidth,
        }))
        expect(widths.doc).toBeLessThanOrEqual(widths.view)
        expect(errors).toEqual([])
      })

      test('Pause animation stops the loops and Play brings them back', async ({ page }) => {
        await openLanding(page)
        await expect(page.locator('html')).toHaveAttribute('data-motion', 'on')
        await page.getByRole('button', { name: 'Pause animation' }).click()
        await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
        const running = await page.evaluate(
          () => document.querySelector('.lk-layer')!.getAnimations().length,
        )
        expect(running).toBe(0)
        await page.getByRole('button', { name: 'Play animation' }).click()
        await expect(page.locator('html')).toHaveAttribute('data-motion', 'on')
      })
    })
  }
}

test.describe('story sections', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the sample day changes its plan when a day is picked', async ({ page }) => {
    await openLanding(page)
    const sample = page.locator('#sample')
    await sample.scrollIntoViewIfNeeded()
    await expect(sample.getByRole('heading', { level: 3 })).toHaveText(
      'If one income drops by half',
    )
    await sample.getByRole('radio', { name: 'Income stops' }).check()
    await expect(sample.getByRole('heading', { level: 3 })).toHaveText('If income stops')
    await expect(page.getByRole('status').filter({ hasText: 'income stops' })).toBeVisible()
  })

  test('the board shows only what is available, with no Live or Planned tags or roadmap', async ({
    page,
  }) => {
    await openLanding(page)
    const items = page.locator('#story li')
    expect(await items.count()).toBeGreaterThan(8)
    await expect(page.locator('#story .lk-st')).toHaveCount(0)
    await expect(page.locator('main, body').first()).not.toContainText(/\bplanned\b/i)
  })

  test('the sticky Start free bar appears mid-page on a phone and not at the top', async ({
    page,
  }) => {
    await openLanding(page)
    const bar = page.locator('.lk-sticky')
    await expect(bar).not.toHaveClass(/\bon\b/)
    await page.locator('#story').scrollIntoViewIfNeeded()
    await expect(bar).toHaveClass(/\bon\b/)
  })

  test('FAQ answers open and the FAQ JSON-LD matches the page', async ({ page }) => {
    await openLanding(page)
    const visible = await page.locator('#faq summary').allTextContents()
    const ld = await page.evaluate(() =>
      [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((s) => JSON.parse(s.textContent!))
        .flatMap((d) => d['@graph'] ?? [d])
        .filter((n) => n['@type'] === 'FAQPage')
        .flatMap((n) => n.mainEntity.map((q: { name: string }) => q.name)),
    )
    expect(ld).toEqual(visible)
  })
})
