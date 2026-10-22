import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HomeExperience } from '../HomeExperience'

vi.mock('@/lib/growth-track', () => ({ track: vi.fn() }))
afterEach(cleanup)

describe('homepage live content', () => {
  it('keeps the live homepage message and detailed sections', () => {
    render(<HomeExperience />)
    for (const name of [
      'Your family’s chart, kept current.',
      'Four bad days, and what Keel would check.',
      'The same chart, as life changes.',
      'Ready before. Found during. Sorted after.',
      'Skip the retyping.',
      'Free to start. One optional paid plan.',
      'Straight answers.',
    ])
      expect(screen.getByRole('heading', { name })).toBeTruthy()
    expect(screen.getByText('£7.99 a month')).toBeTruthy()
    expect(screen.queryByText(/deleted immediately|Deletion is immediate/i)).toBeNull()
  })

  it('keeps the sample scenarios interactive', () => {
    render(<HomeExperience />)
    const scenario = screen.getByRole('radio', { name: 'Income stops' })
    fireEvent.click(scenario)
    expect((scenario as HTMLInputElement).checked).toBe(true)
    expect(
      (screen.getByRole('radio', { name: 'One income drops' }) as HTMLInputElement).checked,
    ).toBe(false)
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
