import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HomeExperience } from '../HomeExperience'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
afterEach(cleanup)

describe('homepage live content', () => {
  it('keeps the live homepage message and detailed sections', () => {
    render(<HomeExperience />)
    for (const name of [
      'Know where to look.',
      'A difficult ordinary day.',
      'Through the year.',
      'What the list is for.',
      'What we promise, in plain words.',
      'Free for a household. One optional plan.',
      'Straight answers.',
      'Begin.',
    ])
      expect(screen.getByRole('heading', { name })).toBeTruthy()
    expect(screen.getByText('£7.99 a month')).toBeTruthy()
    expect(screen.queryByText(/deleted immediately|Deletion is immediate/i)).toBeNull()
  })

  it('carries the film in order: hero, the day, the year, the promises, then the price', () => {
    render(<HomeExperience />)
    const after = (a: string, b: string) =>
      screen
        .getByRole('heading', { name: a })
        .compareDocumentPosition(screen.getByRole('heading', { name: b })) &
      Node.DOCUMENT_POSITION_FOLLOWING
    expect(after('Know where to look.', 'A difficult ordinary day.')).toBeTruthy()
    expect(after('A difficult ordinary day.', 'Through the year.')).toBeTruthy()
    expect(after('Through the year.', 'What we promise, in plain words.')).toBeTruthy()
    expect(
      after('What we promise, in plain words.', 'Free for a household. One optional plan.'),
    ).toBeTruthy()
    // The old story sections under the promises are gone (PR 608).
    for (const old of [
      'Three steps. One evening.',
      'One problem, one evening, one number.',
      'The things your family says out loud.',
      'Keep the household record current.',
    ])
      expect(screen.queryByRole('heading', { name: old })).toBeNull()
  })

  it('preserves navigation and signup anchors without duplicate IDs', () => {
    const { container } = render(<HomeExperience />)
    for (const anchor of ['stories', 'pricing', 'security', 'faq', 'signup']) {
      expect(container.querySelector(`#${anchor}`)).not.toBeNull()
    }
    const ids = Array.from(container.querySelectorAll('[id]')).map((node) => node.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(container.querySelector('#signup a')?.getAttribute('href')).toMatch(/\/signup$/)
  })

  it('uses one cast: the hero sample list and the story name the same people', () => {
    const { container } = render(<HomeExperience />)
    const text = container.textContent ?? ''
    for (const name of ['Dev', 'Marcia', 'Asha']) expect(text).toContain(name)
    expect(text).not.toMatch(/\b(Sam|Alex|Mia)\b/)
  })
})
