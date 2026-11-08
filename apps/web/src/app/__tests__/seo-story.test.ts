/**
 * The page title, description, structured data and llms.txt tell the same story as the page: a
 * shared family list, "Know where to look". They said "one money question, one number, both of you"
 * after the page changed. This keeps them in step, short enough to show in search results, in plain
 * words, and no bolder than the page.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { SITE_DESCRIPTION, SITE_TITLE } from '@/lib/site-copy'
import { CHAPTERS } from '@/components/landing/capabilities'

const root = path.resolve(__dirname, '..', '..', '..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

describe('title and description', () => {
  it('say what LifeKeel is, in the words of the page', () => {
    expect(SITE_TITLE).toBe('LifeKeel — a shared family list. Know where to look.')
    expect(SITE_DESCRIPTION).toMatch(/family list/)
    expect(SITE_DESCRIPTION).toMatch(/policies, cars, school dates and who to call/)
    expect(SITE_DESCRIPTION).toMatch(/Every adult is asked to confirm they have seen it/)
    expect(SITE_DESCRIPTION).toMatch(/Information, not advice/)
  })

  it('fit a search result', () => {
    expect(SITE_TITLE.length).toBeLessThanOrEqual(65)
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(160)
  })

  it('no longer tell the money-runway story, and make no claim the page does not', () => {
    const all = `${SITE_TITLE} ${SITE_DESCRIPTION}`
    expect(all).not.toMatch(
      /one money question|one number|both of you|answer in months|\bbrief\b|runway|roster/i,
    )
    expect(all).not.toMatch(
      /everything|already there|never miss|protect|peace of mind|best|guarantee/i,
    )
  })

  it('are used by the layout for the page, social cards and structured data', () => {
    const layout = read('src/app/layout.tsx')
    expect(layout).toContain("from '@/lib/site-copy'")
    expect(layout).not.toMatch(/one money question/i)
    expect(layout).toMatch(/title:\s*SITE_TITLE/)
    expect(layout.match(/description:\s*SITE_DESCRIPTION/g)?.length).toBeGreaterThanOrEqual(3)
  })
})

describe('social card', () => {
  it('has alt text that matches the page, and the image is the right size', () => {
    expect(read('src/app/layout.tsx')).toMatch(/alt: 'LifeKeel\. Know where to look\.'/)
    const png = fs.readFileSync(path.join(root, 'public/og-image.png'))
    expect(png.readUInt32BE(16)).toBe(1200)
    expect(png.readUInt32BE(20)).toBe(630)
    expect(png.length).toBeLessThan(300_000)
  })
})

describe('llms.txt', () => {
  const text = read('public/llms.txt')

  it('opens with the family list, not the old chart', () => {
    expect(text.split('\n').slice(0, 12).join(' ')).toMatch(/shared family list/i)
    expect(text).not.toMatch(/family's chart|savings runway|\broster\b/i)
  })

  it('lists the six chapters a family says out loud', () => {
    for (const c of CHAPTERS) expect(text, c.name).toContain(c.name)
  })

  it('keeps the honest limits', () => {
    // The sentences wrap across lines (and across the '> ' of the opening quote), so allow for that.
    const flat = text.replace(/\n>?\s*/g, ' ')
    expect(flat).toMatch(/not financial, investment, tax, or legal advice/i)
    expect(flat).toMatch(/never moves money/i)
    expect(flat).toMatch(/asked to confirm/i)
  })
})
