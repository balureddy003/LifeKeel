import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HomeExperience } from '../HomeExperience'
import { TRUST_FOOTNOTE, TRUST_PROMISES } from '../TrustAct'
import { CLAIMS } from '../claims'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
afterEach(cleanup)

describe('the trust act', () => {
  it('makes eight promises, each resting only on a live claim', () => {
    expect(TRUST_PROMISES).toHaveLength(8)
    for (const p of TRUST_PROMISES) {
      expect(p.claims.length, p.promise).toBeGreaterThan(0)
      for (const id of p.claims) expect(CLAIMS.find((c) => c.id === id)?.status, id).toBe('live')
    }
  })

  it('never leans on the claims held back from this page', () => {
    const used = TRUST_PROMISES.flatMap((p) => p.claims)
    expect(used).not.toContain('no-training')
    expect(used).not.toContain('always-on')
    const text = TRUST_PROMISES.map((p) => `${p.promise} ${p.gloss}`).join(' ')
    expect(text).not.toMatch(
      /never train|training data|always on|always watching|24\/7|around the clock/i,
    )
  })

  it('sets each promise on its own line with the gloss beneath it, in order', () => {
    const { container } = render(<HomeExperience />)
    const rows = [...container.querySelectorAll('.lk-trust-row')]
    expect(rows).toHaveLength(TRUST_PROMISES.length)
    rows.forEach((row, i) => {
      const p = TRUST_PROMISES[i]!
      expect(row.querySelector('dt')?.textContent).toBe(p.promise)
      expect(row.querySelector('dd')?.textContent).toBe(p.gloss)
      expect(row.getAttribute('data-claims')).toBe(p.claims.join(' '))
    })
  })

  it('closes on the quiet footnote, after the last promise', () => {
    const { container } = render(<HomeExperience />)
    const foot = container.querySelector('.lk-trust-foot')!
    expect(foot.textContent).toBe(TRUST_FOOTNOTE)
    const last = container.querySelectorAll('.lk-trust-row')[TRUST_PROMISES.length - 1] as Element
    expect(last.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('sits after the year and before the long feature list', () => {
    render(<HomeExperience />)
    const h = (name: string) => screen.getByRole('heading', { name })
    const year = h('Through the year.')
    const trust = h('What we promise, in plain words.')
    const features = h('The things your family says out loud.')
    expect(year.compareDocumentPosition(trust) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(trust.compareDocumentPosition(features) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('offers nothing to click, no badge, no score and no customer count', () => {
    const { container } = render(<HomeExperience />)
    const section = container.querySelector('.lk-trust')!
    expect(section.querySelectorAll('a, button')).toHaveLength(0)
    expect(section.textContent).not.toMatch(
      /trust score|badge|certified|10,000|thousands of families/i,
    )
    expect(section.textContent).not.toMatch(/\d+%|\bguarantee\b/i)
  })

  it('says only what each claim backs: encrypted when stored, and AI providers named, not "nobody"', () => {
    const text = TRUST_PROMISES.map((p) => `${p.promise} ${p.gloss}`).join(' ')
    // Encryption happens on the server before storage, not on the device.
    expect(text).not.toMatch(/before it reaches our servers|end-to-end/i)
    expect(text).toMatch(/encrypted before they are stored/i)
    // Requests do reach the AI providers listed on the Trust page (CLAUDE.md rule 3).
    expect(text).not.toMatch(/anyone off the team|never leaves your account/i)
    expect(text).toMatch(/AI providers listed on the Trust page/)
  })
})
