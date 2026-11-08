/**
 * The story board is seven chapters, each a thing a family says out loud. Chapters 1 to 6 are on the
 * board (this file); chapter 7, "It's yours", is the trust section. A new use case is one line on the
 * board and one claim, never a new story (docs/research/brand-and-story-guide-2026-11-08.md).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { CAPABILITIES, CHAPTERS } from '../capabilities'
import { CLAIMS } from '../claims'
import { Features } from '../VividSections'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))
afterEach(cleanup)

const REPO = path.resolve(__dirname, '..', '..', '..', '..', '..', '..')

describe('the chapters', () => {
  it('are six on the board, each a thing a family says, in order', () => {
    expect(CHAPTERS.map((c) => c.id)).toEqual(['find', 'know', 'dates', 'ask', 'help', 'change'])
    expect(CHAPTERS.map((c) => c.says)).toEqual([
      '“Where’s the…?”',
      '“Do you know about…?”',
      '“What’s coming up?”',
      '“What if we…?”',
      '“Something’s happened.”',
      '“Things have changed.”',
    ])
  })

  it('every board item belongs to a chapter', () => {
    const ids = new Set(CHAPTERS.map((c) => c.id))
    expect(CAPABILITIES.filter((c) => !ids.has(c.chapter)).map((c) => c.claim)).toEqual([])
  })

  it('every chapter has something live to show', () => {
    for (const ch of CHAPTERS)
      expect(
        CAPABILITIES.filter((c) => c.chapter === ch.id && c.live).length,
        ch.id,
      ).toBeGreaterThan(0)
  })

  it('the family list and the shared look are the first things the page shows', () => {
    const find = CAPABILITIES.filter((c) => c.chapter === 'find' && c.live)
    expect(find[0]?.claim).toBe('family-list')
    const know = CAPABILITIES.filter((c) => c.chapter === 'know' && c.live)
    expect(know[0]?.claim).toBe('every-adult-confirms')
  })

  it('the use cases built since the story was written are on the board with live claims', () => {
    for (const id of [
      'join-with-code',
      'edit-access',
      'dates-coming-up',
      'first-steps-from-list',
      'leave-and-removal',
      'monthly-letter',
    ]) {
      expect(
        CAPABILITIES.find((c) => c.claim === id),
        id,
      ).toBeTruthy()
      const claim = CLAIMS.find((c) => c.id === id)
      expect(claim?.status, id).toBe('live')
      expect(fs.existsSync(path.join(REPO, claim?.evidence ?? 'missing')), id).toBe(true)
    }
  })

  it('uses plain nouns: no "brief", "runway" or "roster" in what a family reads', () => {
    const text = CAPABILITIES.filter((c) => c.live)
      .map((c) => `${c.text} ${c.qualifier ?? ''}`)
      .join(' ')
    expect(text).not.toMatch(/\b(brief|runway|roster)\b/i)
  })
})

describe('the chapters on the page', () => {
  it('shows each chapter with its family line and only live scenes', () => {
    render(<Features />)
    for (const ch of CHAPTERS) {
      const card = screen.getByRole('article', { name: new RegExp(ch.name) })
      expect(within(card).getByText(ch.says)).toBeTruthy()
      for (const cap of CAPABILITIES.filter((c) => c.chapter === ch.id)) {
        if (cap.live) expect(within(card).getByText(cap.text)).toBeTruthy()
        else expect(within(card).queryByText(cap.text)).toBeNull()
      }
    }
  })

  it('keeps the honest qualifier beside every live scene', () => {
    const { container } = render(<Features />)
    const live = CAPABILITIES.filter((c) => c.live)
    expect(container.querySelectorAll('small').length).toBeGreaterThanOrEqual(live.length)
  })

  it('says no Live or Planned wording on the public page', () => {
    const { container } = render(<Features />)
    expect(container.textContent).not.toMatch(/\b(Live|Planned|Coming soon)\b/)
  })
})
