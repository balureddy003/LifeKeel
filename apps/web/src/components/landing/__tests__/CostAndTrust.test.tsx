import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HomeExperience } from '../HomeExperience'
import { AboutContent } from '../MarketingPage'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
afterEach(cleanup)

const after = (a: string, b: string) =>
  screen
    .getByRole('heading', { name: a })
    .compareDocumentPosition(screen.getByRole('heading', { name: b })) &
  Node.DOCUMENT_POSITION_FOLLOWING

describe('the promises up front', () => {
  it('opens /about with the six promises', () => {
    render(<AboutContent />)
    expect(screen.getByRole('heading', { name: 'Six things Keel does not do.' })).toBeTruthy()
  })

  it('puts what LifeKeel does not do on the home page, before the price', () => {
    render(<HomeExperience />)
    expect(after('What Keel does not do.', 'Free to start. One optional paid plan.')).toBeTruthy()
  })
})

describe('headings stand alone', () => {
  it('no marketing heading carries an explanation paragraph under it', () => {
    const { container } = render(
      <>
        <HomeExperience />
        <AboutContent />
      </>,
    )
    expect(container.querySelector('.vv-intro, .vv-lede')).toBeNull()
  })
})
