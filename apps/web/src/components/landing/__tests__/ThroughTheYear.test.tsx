import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HomeExperience } from '../HomeExperience'
import { VIGNETTES, YEAR_CAPTION, YEAR_CLOSING } from '../ThroughTheYear'
import { CLAIMS } from '../claims'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
afterEach(cleanup)

describe('through the year', () => {
  it('tells exactly three ordinary moments, each resting only on live claims', () => {
    expect(VIGNETTES).toHaveLength(3)
    for (const v of VIGNETTES)
      for (const id of v.claims)
        expect(CLAIMS.find((c) => c.id === id)?.status, `${v.when}: ${id}`).toBe('live')
  })

  it('keeps the brief’s three titles, in order, with the row that lands on the list', () => {
    expect(VIGNETTES.map((v) => v.title)).toEqual([
      'A renewal in February.',
      'A trip deposit in spring.',
      'A staff change in autumn.',
    ])
    render(<HomeExperience />)
    for (const v of VIGNETTES) {
      expect(screen.getByRole('heading', { name: v.title })).toBeTruthy()
      expect(screen.getByText(v.row)).toBeTruthy()
    }
  })

  it('sits after the difficult day and before the three ordinary moments', () => {
    render(<HomeExperience />)
    const year = screen.getByRole('heading', { name: 'Through the year.' })
    const day = screen.getByRole('heading', { name: 'A difficult ordinary day.' })
    const moments = screen.getByRole('heading', { name: 'Things that usually live in one head.' })
    expect(day.compareDocumentPosition(year) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(year.compareDocumentPosition(moments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('closes on the Tuesday line, after the props, and captions them as examples', () => {
    const { container } = render(<HomeExperience />)
    const section = container.querySelector('.lk-year')!
    expect(section.textContent).toContain(YEAR_CAPTION)
    expect(section.textContent).toContain(YEAR_CLOSING)
    const closing = section.querySelector('.lk-year-closing')!
    expect(closing.textContent).toBe(YEAR_CLOSING)
    expect(
      section.querySelector('.lk-year-grid')!.compareDocumentPosition(closing) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('draws one ink tick per name on each prop, and no fourth vignette', () => {
    const { container } = render(<HomeExperience />)
    const cards = container.querySelectorAll('.lk-year-card')
    expect(cards).toHaveLength(3)
    for (const card of cards) {
      const ticks = card.querySelectorAll('.lk-year-seen .lk-msl-tick')
      const names = VIGNETTES.find((v) => card.textContent?.includes(v.title))!.seenBy
      expect(ticks).toHaveLength(names.length)
    }
  })

  it('offers no call to action and no numbers in this scroll', () => {
    const { container } = render(<HomeExperience />)
    const section = container.querySelector('.lk-year')!
    expect(section.querySelectorAll('a, button')).toHaveLength(0)
    expect(section.textContent).not.toMatch(/%|£|\bgrowth\b|\breturns\b|\bsave\b/i)
  })

  it('does not sell, advise or dramatise', () => {
    const text = [
      YEAR_CAPTION,
      YEAR_CLOSING,
      ...VIGNETTES.map((v) => `${v.title} ${v.body} ${v.row} ${v.seenBy.join(' ')}`),
    ].join(' ')
    expect(text).not.toMatch(/\byou should\b|\bbuy\b|\bswitch\b|\bpolicy picks?\b/i)
    expect(text).not.toMatch(/crisis|emergency|urgent|panic|hospital|A&E|siren|meltdown/i)
    expect(text).not.toMatch(/\bactivate\b|\btrigger\b/i)
  })
})
