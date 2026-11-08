/**
 * The home offers three equal doors: money is one of them, not the front door.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { ThreeDoors, DOORS } from '../ThreeDoors'

afterEach(cleanup)

describe('ThreeDoors', () => {
  it('shows exactly three equal doors with the right destinations', () => {
    render(<ThreeDoors />)
    const hrefs = DOORS.map((d) =>
      screen.getByRole('link', { name: new RegExp(d.title) }).getAttribute('href'),
    )
    expect(hrefs).toEqual(['/briefs', '/briefs?start=handover_gap', '/life-events'])
    expect(DOORS).toHaveLength(3)
  })

  it('links the cover page without adding a fourth door', () => {
    render(<ThreeDoors />)
    expect(
      screen.getByRole('link', { name: 'See who is covered by which policy' }).getAttribute('href'),
    ).toBe('/domains?d=life_protection')
  })
})
