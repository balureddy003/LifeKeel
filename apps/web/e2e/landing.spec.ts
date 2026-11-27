import { test, expect, type Page } from '@playwright/test'

/**
 * The public landing page at desktop and phone widths, light and dark.
 * Anonymous: it clears the signed-in storage state the rest of the suite uses.
 *
 * Run locally against the dev stack:
 *   pnpm --filter @lifekeel/web exec playwright test landing
 * CI does not run Playwright; the unit tests (landing/__tests__) cover CI.
 */
test.use({ storageState: { cookies: [], origins: [] } })

/** The app shows a skeleton until the auth check settles, so wait for the hero first. */
async function openLanding(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Know where to look')
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
        await openLanding(page)

        const signup = page.getByRole('link', { name: 'Start a free list' }).first()
        await expect(signup).toBeVisible()
        await expect(signup).toHaveAttribute('href', /\/signup$/)

        const widths = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth,
          view: window.innerWidth,
        }))
        expect(widths.doc).toBeLessThanOrEqual(widths.view)
        expect(errors).toEqual([])
      })
    })
  }
}

test.describe('the film, in order', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('runs hero, cost, list, difficult day, year — with no roadmap wording', async ({ page }) => {
    await openLanding(page)
    const order = await page.evaluate(() =>
      [...document.querySelectorAll('main h1, main h2')].map((h) => h.textContent?.trim() ?? ''),
    )
    const at = (text: string) => order.findIndex((t) => t.includes(text))
    const beats = [
      'Know where to look.',
      'Most families run on one person’s memory.',
      'The list is the quiet hero.',
      'A difficult ordinary day.',
      'Through the year.',
      'It belongs to everyone.',
    ]
    for (const beat of beats) expect(at(beat), beat).toBeGreaterThanOrEqual(0)
    const positions = beats.map(at)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))

    const main = await page.locator('main').innerText()
    expect(main).not.toMatch(/\bplanned\b/i)
  })

  test('the sticky Start free bar appears mid-page on a phone and not at the top', async ({
    page,
  }) => {
    await openLanding(page)
    const bar = page.locator('.lk-sticky')
    await expect(bar).not.toHaveClass(/\bon\b/)
    await page.locator('.lk-day').scrollIntoViewIfNeeded()
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
