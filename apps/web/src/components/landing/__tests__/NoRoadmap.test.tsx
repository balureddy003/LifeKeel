/**
 * The public site shows what is available today. Roadmap, Live/Planned tags and "planned"
 * wording live in the app, not on the marketing pages. This fails if they come back.
 */
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, cleanup } from '@testing-library/react'
import { StoryBoard } from '../StoryBoard'
import { YearsTimelapse } from '../YearsTimelapse'
import { CoverOnFile } from '../CoverOnFile'
import { SampleDay } from '../SampleDay'
import { CrisisSteps } from '../CrisisSteps'
import { Promises } from '../Promises'
import { Security } from '../Security'
import { PlusSpotlight } from '../PlusSpotlight'
import { Pricing } from '../Pricing'
import { Faq } from '../Faq'
import { FAQ } from '../faq-data'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))

beforeAll(() => {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
})

afterEach(cleanup)

const DIR = path.resolve(__dirname, '..')
const ROADMAP = /\bplanned\b|\bon the way\b|\bcoming soon\b|\bwill (note|put|say)\b|\bintend to build\b/i

describe('no roadmap on the public site', () => {
  it.each([
    ['StoryBoard', StoryBoard],
    ['YearsTimelapse', YearsTimelapse],
    ['CoverOnFile', CoverOnFile],
    ['SampleDay', SampleDay],
    ['CrisisSteps', CrisisSteps],
    ['Promises', Promises],
    ['Security', Security],
    ['PlusSpotlight', PlusSpotlight],
    ['Pricing', Pricing],
    ['Faq', Faq],
  ] as const)('%s renders no Live or Planned tags and no roadmap wording', (_name, Section) => {
    const { container } = render(<Section />)
    expect(container.textContent).not.toMatch(ROADMAP)
    expect(container.querySelector('.lk-st')).toBeNull()
    for (const el of container.querySelectorAll('span, b, small')) {
      expect(el.textContent?.trim()).not.toMatch(/^(Live|Planned)$/)
    }
  })

  it('the FAQ copy, llms.txt and the landing component sources carry none either', () => {
    expect(FAQ.map((f) => f.q + f.a).join(' ')).not.toMatch(ROADMAP)
    const llms = fs.readFileSync(path.join(DIR, '..', '..', '..', 'public', 'llms.txt'), 'utf8')
    expect(llms).not.toMatch(ROADMAP)
    const sources = fs
      .readdirSync(DIR)
      .filter((f) => /\.tsx$/.test(f) && f !== 'StoryBoard.tsx')
      .map((f) => [f, fs.readFileSync(path.join(DIR, f), 'utf8')] as const)
    for (const [f, text] of sources) expect(text.replace(/\/\*[\s\S]*?\*\//g, ''), f).not.toMatch(/'Planned'|"Planned"|>Planned</)
  })

  it('the landing page no longer includes the planned-route section', () => {
    const page = fs.readFileSync(path.join(DIR, '..', 'MarketingLanding.tsx'), 'utf8')
    expect(page).not.toContain('MarkedRoute')
    expect(fs.existsSync(path.join(DIR, 'MarkedRoute.tsx'))).toBe(false)
  })
})
