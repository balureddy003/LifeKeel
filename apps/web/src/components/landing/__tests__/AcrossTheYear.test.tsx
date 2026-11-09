import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HomeExperience } from '../HomeExperience'
import { YEAR } from '../AcrossTheYear'
import { CLAIMS } from '../claims'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
afterEach(cleanup)

describe('across the year', () => {
  it('tells four moments of one household, each resting only on live claims', () => {
    expect(YEAR).toHaveLength(4)
    for (const step of YEAR)
      for (const id of step.claims) {
        const claim = CLAIMS.find((c) => c.id === id)
        expect(claim?.status, id).toBe('live')
      }
  })

  it('gives every moment its honest limit', () => {
    for (const step of YEAR) expect(step.limit.length, step.season).toBeGreaterThan(10)
  })

  it('sits after the story and before the three ordinary moments', () => {
    render(<HomeExperience />)
    const h = (name: string) => screen.getByRole('heading', { name })
    const story = h('Marcia’s Tuesday.')
    const year = h('One list, four moments in the year.')
    const moments = h('Things that usually live in one head.')
    expect(story.compareDocumentPosition(year) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(year.compareDocumentPosition(moments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('never says what to buy, name or fix, and never promises the product does it for them', () => {
    const text = YEAR.map((s) => `${s.title} ${s.story} ${s.limit}`).join(' ')
    expect(text).not.toMatch(/\byou should\b|\bbuy\b|\bswitch\b|\bgap\b|never bought|not covered/i)
    expect(text).not.toMatch(/\b(contacts|rings|calls|pays|sends) (your|the) (insurer|lender)/i)
  })
})
