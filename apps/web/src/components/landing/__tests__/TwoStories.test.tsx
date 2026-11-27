import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HomeExperience } from '../HomeExperience'
import { HOUSEHOLD_CLAIMS, HOUSEHOLD_ROWS, TEAM_ROWS, TWO_CLOSING } from '../TwoStories'
import { CLAIMS } from '../claims'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
afterEach(cleanup)

const panel = (kind: 'gap' | 'held') =>
  document.querySelector(`.lk-fork-panel[data-kind='${kind}']`)!

describe('the fork: a home list and a team list', () => {
  it('rests the household panel only on live claims', () => {
    expect(HOUSEHOLD_CLAIMS.length).toBeGreaterThan(0)
    for (const id of HOUSEHOLD_CLAIMS) {
      expect(CLAIMS.find((c) => c.id === id)?.status, id).toBe('live')
    }
  })

  it('tells the family story as gaps in the record, not documents in one place', () => {
    const { container } = render(<HomeExperience />)
    const gap = container.querySelector(".lk-fork-panel[data-kind='gap']")!
    const text = gap.textContent ?? ''
    for (const r of HOUSEHOLD_ROWS) {
      expect(text).toContain(r.fact)
      expect(text).toContain(r.state)
    }
    expect(gap.getAttribute('data-claims')).toBe(HOUSEHOLD_CLAIMS.join(' '))
    // The panel is about what was never entered, and says what it is not.
    expect(text).toMatch(/missing/i)
    expect(text).toMatch(/not a recommendation/i)
    expect(text).toMatch(/information only/i)
    // Not a document-storage pitch, and never a recommendation.
    expect(text).not.toMatch(/documents? in one place|filing cabinet|all your paperwork/i)
    expect(text).not.toMatch(/\b(you should|we recommend|consider|buy|switch)\b/i)
  })

  it('tells the team story as knowledge held by one person, and claims nothing', () => {
    const { container } = render(<HomeExperience />)
    const held = container.querySelector(".lk-fork-panel[data-kind='held']")!
    const text = held.textContent ?? ''
    for (const r of TEAM_ROWS) {
      expect(text).toContain(r.fact)
      expect(text).toContain(r.state)
    }
    // The team vertical has no live claims yet; the panel is illustrative.
    expect(held.getAttribute('data-claims')).toBeNull()
    expect(text).toMatch(/one person/i)
    expect(text).toMatch(/made-up team example/i)
    expect(text).not.toMatch(/£|\d+%|guarantee/i)
  })

  it('sets the two sheets apart: a gap is italic, a held row is mono', () => {
    render(<HomeExperience />)
    expect(panel('gap').querySelectorAll('.lk-fork-row')).toHaveLength(HOUSEHOLD_ROWS.length)
    expect(panel('held').querySelectorAll('.lk-fork-row')).toHaveLength(TEAM_ROWS.length)
    expect(panel('gap').querySelector('.lk-fork-row dd')?.textContent).toBe(
      HOUSEHOLD_ROWS[0]!.state,
    )
    expect(panel('held').querySelector('.lk-fork-row dd')?.textContent).toBe(TEAM_ROWS[0]!.state)
  })

  it('closes the pair on the line that names the difference', () => {
    const { container } = render(<HomeExperience />)
    const close = container.querySelector('.lk-fork-closing')!
    expect(close.textContent).toBe(TWO_CLOSING)
    const held = panel('held')
    expect(held.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('sits between the list and the difficult day, and offers nothing to click', () => {
    const { container } = render(<HomeExperience />)
    const h = (name: string) => screen.getByRole('heading', { name })
    const list = h('The list is the quiet hero.')
    const fork = h('Different questions, same list.')
    const day = h('A difficult ordinary day.')
    expect(list.compareDocumentPosition(fork) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(fork.compareDocumentPosition(day) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelector('.lk-fork')!.querySelectorAll('a, button')).toHaveLength(0)
  })
})
