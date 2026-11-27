/**
 * Scroll 2 — the list as character.
 *
 * The section answers "what is the point of a list?" between the cost and
 * the difficult day. Its job is restraint: no money moved, no product picked,
 * no advice given, and the honest tick line under the sheet.
 *
 * Copy rules referenced:
 *   - docs/marketing/cinematic-site-redesign-2026-11-26.md §5 (Scroll 2)
 *   - apps/web/src/components/landing/claims.ts (live registry)
 *   - CostAndTrust.test.tsx (no disaster / no advice vocabulary)
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LIST_HONEST, LIST_LEAD, LIST_LINES, TheList } from '../TheList'
import { CLAIMS } from '../claims'
import { SAMPLE_CHANGED_NOTE, SAMPLE_ROWS } from '../sample-list'

afterEach(cleanup)

describe('TheList (Scroll 2)', () => {
  it('names the list as the quiet hero, in the plain three-line voice', () => {
    render(<TheList />)
    expect(
      screen.getByRole('heading', { level: 2, name: 'The list is the quiet hero.' }),
    ).toBeTruthy()
    for (const line of LIST_LINES) expect(screen.getByText(line)).toBeTruthy()
    expect(screen.getByText(LIST_LEAD)).toBeTruthy()
  })

  it('shows the same sheet as the hero, one beat later, with the change note', () => {
    render(<TheList />)
    const prop = screen.getByTestId('marketing-seen-by-list')
    for (const row of SAMPLE_ROWS) expect(prop.textContent).toContain(row.text)
    expect(prop.textContent).toContain(SAMPLE_CHANGED_NOTE)
    // The illustrative caption is on every instance of the prop.
    expect(prop.textContent).toContain('Yours begins empty and stays yours.')
  })

  it('keeps the prop inert: no buttons, links or fields on the sample sheet', () => {
    render(<TheList />)
    const prop = screen.getByTestId('marketing-seen-by-list')
    expect(prop.querySelectorAll('button, a, input, select, textarea')).toHaveLength(0)
  })

  it('sets the honest line under the sheet it is talking about', () => {
    const { container } = render(<TheList />)
    expect(screen.getByText(LIST_HONEST)).toBeTruthy()
    const prop = container.querySelector('.lk-list-prop')!
    const honest = container.querySelector('.lk-list-honest')!
    expect(prop.compareDocumentPosition(honest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('stays ordinary: no disaster imagery, no fear, no advice', () => {
    const text = [...LIST_LINES, LIST_LEAD, LIST_HONEST, SAMPLE_CHANGED_NOTE].join(' ')
    expect(text).not.toMatch(/hospital|A&E|die[ds]?\b|death|dead|accident|panic|too late/i)
    expect(text).not.toMatch(/\byou should\b|\bbuy\b|\bgap\b|not covered/i)
    expect(text).not.toMatch(/every adult has seen it|always watching|24\/7/i)
  })

  it('every claim it relies on is live in the registry', () => {
    for (const id of [
      'family-list',
      'every-adult-confirms',
      'no-money-moved',
      'no-policy-picks',
      'no-commissions',
    ]) {
      const claim = CLAIMS.find((x) => x.id === id)
      expect(claim, id).toBeTruthy()
      expect(claim!.status, id).toBe('live')
    }
  })
})
