import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HomeExperience } from '../HomeExperience'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
afterEach(cleanup)

describe('homepage live content', () => {
  it('keeps the live homepage message and detailed sections', () => {
    render(<HomeExperience />)
    for (const name of [
      'Your family’s money, cover and papers. One bright place.',
      'Three steps to a clearer picture.',
      'One problem, one evening, one number.',
      'Ready before. Found during. Sorted after.',
      'When something happens, your family has somewhere to start.',
      'Keep the household record current.',
      'Six things Keel does not do.',
      'Free to start. One optional paid plan.',
      'Straight answers.',
      'Make your account. Keel starts checking what you tell it.',
    ])
      expect(screen.getByRole('heading', { name })).toBeTruthy()
    expect(screen.getByText('£7.99 a month')).toBeTruthy()
    expect(screen.queryByText(/deleted immediately|Deletion is immediate/i)).toBeNull()
  })

  it('leads with the three brief problems, not a sample family', () => {
    render(<HomeExperience />)
    for (const name of [
      'One of us might stop earning',
      'Someone is about to earn less',
      'The other adult does not know',
    ]) {
      expect(screen.getByText(name)).toBeTruthy()
    }
    // Each question is a link that carries the choice through signup.
    const cards: Array<[string, string]> = [
      ['One of us might stop earning', 'income_stops'],
      ['Someone is about to earn less', 'earning_less'],
      ['The other adult does not know', 'handover_gap'],
    ]
    for (const [name, id] of cards) {
      expect(screen.getByRole('link', { name }).getAttribute('href')).toContain(
        `/signup?brief=${id}`,
      )
    }
    // The made-up sample-household picker is gone from the front door
    // (Intent 70); a labelled mock figure elsewhere is fine.
    expect(screen.queryByRole('radio', { name: 'Income stops' })).toBeNull()
  })

  it('preserves navigation and signup anchors without duplicate IDs', () => {
    const { container } = render(<HomeExperience />)
    for (const anchor of ['how-it-works', 'features', 'pricing', 'security', 'faq', 'signup']) {
      expect(container.querySelector(`#${anchor}`)).not.toBeNull()
    }
    const ids = Array.from(container.querySelectorAll('[id]')).map((node) => node.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(container.querySelector('#signup a')?.getAttribute('href')).toMatch(/\/signup$/)
  })
})
