import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HomeExperience } from '../HomeExperience'
import { HowItWorksContent } from '../MarketingPage'
import { VividHero } from '../VividHero'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
afterEach(cleanup)

const after = (a: string, b: string) =>
  screen
    .getByRole('heading', { name: a })
    .compareDocumentPosition(screen.getByRole('heading', { name: b })) &
  Node.DOCUMENT_POSITION_FOLLOWING

describe('the short home page', () => {
  it('says one thing per section, in order, and stops', () => {
    const { container } = render(<HomeExperience />)
    const order = [
      'Know where to look.',
      'Three things, from what your family adds.',
      'Three steps. One evening.',
      'What Keel does not do.',
      'Free to start. One optional paid plan.',
      'Make your account. Keel starts checking what you tell it.',
    ]
    for (let i = 1; i < order.length; i++) expect(after(order[i - 1]!, order[i]!)).toBeTruthy()
    // The long sections moved to their own pages.
    expect(container.querySelectorAll('section').length).toBeLessThanOrEqual(7)
    for (const moved of [
      'One problem, one evening, one number.',
      'The things your family says out loud.',
      'Marcia’s Tuesday.',
      'Six things Keel does not do.',
      'Straight answers.',
    ])
      expect(screen.queryByRole('heading', { name: moved })).toBeNull()
    expect(screen.getByText('£7.99 a month')).toBeTruthy()
  })

  it('links each section to the page with the rest', () => {
    render(<HomeExperience />)
    const href = (name: string | RegExp) => screen.getByRole('link', { name }).getAttribute('href')
    expect(href('How it works')).toBe('/how-it-works')
    expect(href('See the features')).toBe('/features')
    expect(href('During and after')).toBe('/features#bad-day')
    expect(href('The full walkthrough')).toBe('/how-it-works')
    expect(href('All six, and what we do with your data')).toBe('/about')
    expect(href('Compare plans')).toBe('/pricing')
  })

  it('keeps the signup anchor and has no duplicate IDs', () => {
    const { container } = render(<HomeExperience />)
    expect(container.querySelector('#signup a')?.getAttribute('href')).toMatch(/\/signup$/)
    const ids = Array.from(container.querySelectorAll('[id]')).map((node) => node.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('/how-it-works', () => {
  it('leads with the brief problems, each carrying its choice through signup', () => {
    render(<HowItWorksContent />)
    const cards: Array<[string, string]> = [
      ['One of us might stop earning', 'income_stops'],
      ['Someone is about to earn less', 'earning_less'],
      ['The other adult does not know', 'handover_gap'],
      ['Our mortgage fix is ending', 'mortgage_fix'],
      ['Nursery or school fees are starting', 'fees_start'],
      ['A job change or notice period', 'job_change'],
    ]
    for (const [name, id] of cards)
      expect(screen.getByRole('link', { name }).getAttribute('href')).toContain(
        `/signup?brief=${id}`,
      )
    expect(after('One problem, one evening, one number.', 'Three steps. One evening.')).toBeTruthy()
    expect(after('Three steps. One evening.', 'Marcia’s Tuesday.')).toBeTruthy()
    // The made-up sample-household picker stays off the front door (Intent 70).
    expect(screen.queryByRole('radio', { name: 'Income stops' })).toBeNull()
  })

  it('uses one cast: the hero sample list and the story name the same people', () => {
    const { container } = render(
      <>
        <VividHero />
        <HowItWorksContent />
      </>,
    )
    const text = container.textContent ?? ''
    for (const name of ['Dev', 'Marcia', 'Asha']) expect(text).toContain(name)
    expect(text).not.toMatch(/\b(Sam|Alex|Mia)\b/)
  })

  it('has no duplicate IDs', () => {
    const { container } = render(<HowItWorksContent />)
    const ids = Array.from(container.querySelectorAll('[id]')).map((node) => node.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
