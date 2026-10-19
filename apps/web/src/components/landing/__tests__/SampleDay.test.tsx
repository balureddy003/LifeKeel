import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SampleDay } from '../SampleDay'
import { StoryBoard } from '../StoryBoard'
import { CAPABILITIES } from '../capabilities'

afterEach(cleanup)

describe('SampleDay', () => {
  it('is a read-only radio group with the four sample days and no other input', () => {
    const { container } = render(<SampleDay />)
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(4)
    expect(container.querySelectorAll('input').length).toBe(4)
    expect(screen.getByRole('radio', { name: 'One income drops' })).toHaveProperty('checked', true)
    expect(container.querySelector('[aria-live]')).toBeNull()
  })

  it('shows the maths and announces one sentence through role=status when a day is picked', () => {
    render(<SampleDay />)
    expect(screen.getByText(/Runway = £8,200/)).toBeTruthy()
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('')
    fireEvent.click(screen.getByRole('radio', { name: 'Income stops' }))
    expect(status.textContent).toContain('income stops')
    expect(status.textContent).toContain('2.8')
    expect(status.textContent).toContain('Under 3 months')
    expect(screen.getByText('If income stops')).toBeTruthy()
  })

  it('draws the earner scenario as 24+ and shows the real figure in the maths, plus its hard-day note', () => {
    render(<SampleDay />)
    fireEvent.click(screen.getByRole('radio', { name: 'Losing a main earner' }))
    expect(screen.getByText('24+')).toBeTruthy()
    expect(screen.getByText(/= 64\.9 months \(drawn as 24\+\)/)).toBeTruthy()
    expect(screen.getByText(/hard one to look at/)).toBeTruthy()
  })
})

describe('StoryBoard', () => {
  it('shows only what is available today, each with its note, and no Live or Planned tags', () => {
    const { container } = render(<StoryBoard />)
    const available = CAPABILITIES.filter((c) => c.live)
    const items = container.querySelectorAll('li')
    expect(items.length).toBe(available.length)
    for (const c of available) {
      const li = [...items].find((el) => el.textContent?.includes(c.text))!
      expect(li, c.text).toBeTruthy()
      expect(li.querySelector('.lk-q'), c.text).not.toBeNull()
    }
    for (const c of CAPABILITIES.filter((x) => !x.live)) {
      expect(container.textContent, c.text).not.toContain(c.text)
    }
    expect(container.querySelector('.lk-st')).toBeNull()
  })

  it('uses the word platform once on the whole page copy, and never in a heading', () => {
    const dir = path.resolve(__dirname, '..')
    const files = [
      ...fs
        .readdirSync(dir)
        .filter((f) => /\.tsx?$/.test(f) && f !== 'claims.ts')
        .map((f) => path.join(dir, f)),
      path.resolve(dir, '..', 'MarketingLanding.tsx'),
    ]
    const hits = files.flatMap((f) =>
      fs
        .readFileSync(f, 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && /\bplatform\b/i.test(l)),
    )
    expect(hits).toHaveLength(1)
    const { container } = render(<StoryBoard />)
    expect(
      [...container.querySelectorAll('h2,h3')].some((h) => /platform/i.test(h.textContent!)),
    ).toBe(false)
  })

  it('draws lanterns inline, with no dependency on shared symbols', () => {
    const { container } = render(<StoryBoard />)
    expect(container.querySelector('use')).toBeNull()
  })
})
