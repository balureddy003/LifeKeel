import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HomeExperience } from '../HomeExperience'
import { MOMENTS } from '../MomentCards'
import { CLAIMS } from '../claims'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
afterEach(cleanup)

describe('three ordinary moments', () => {
  it('rests every moment on a live claim and shows its limit', () => {
    for (const m of MOMENTS) {
      const claim = CLAIMS.find((c) => c.id === m.claim)
      expect(claim?.status, m.claim).toBe('live')
      expect(m.limit.length).toBeGreaterThan(10)
    }
  })

  it('sits right after the story and before the chapters', () => {
    render(<HomeExperience />)
    const pos = (name: string) => screen.getByRole('heading', { name })
    const story = pos('Marcia’s Tuesday.')
    const moments = pos('Things that usually live in one head.')
    const chapters = pos('The things your family says out loud.')
    expect(story.compareDocumentPosition(moments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(
      moments.compareDocumentPosition(chapters) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('never tells a family what to buy, name or fix', () => {
    const text = MOMENTS.map((m) => `${m.title} ${m.story} ${m.limit}`).join(' ')
    expect(text).not.toMatch(/\byou should\b|\bbuy\b|\bswitch\b|\bgap\b|never bought|not covered/i)
  })
})
