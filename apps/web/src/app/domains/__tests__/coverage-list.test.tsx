/**
 * "Who is covered by what" as grouped lists, one group per person, instead of a table that scrolled
 * sideways on a phone. Same facts in the same words; a policy nobody is matched to gets its own group.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { CoverageList } from '../CoverageList'

afterEach(cleanup)

const matrix = {
  label: 'Who is covered by what',
  columns: [
    { id: 'sam', name: 'Sam' },
    { id: 'alex', name: 'Alex' },
    { id: 'kai', name: 'Kai' },
  ],
  rows: [
    { id: 'p1', label: 'Policy · Provider A', cells: { sam: 'holds', alex: 'covers' } },
    { id: 'p2', label: 'Policy · Provider B', cells: { sam: 'holds_and_covers' } },
    { id: 'e1', label: 'Cover through an employer · Acme', cells: { alex: 'employer' } },
    { id: 'p3', label: 'Policy · Test Insurer', cells: {} },
  ],
} as const

const group = (name: string) => screen.getByRole('group', { name })

describe('CoverageList', () => {
  it('has one labelled group per person with their policies and how each relates to them', () => {
    render(<CoverageList matrix={matrix as never} />)
    const sam = within(group('Sam'))
    expect(sam.getByText('Policy · Provider A')).toBeTruthy()
    expect(sam.getByText('Holds it')).toBeTruthy()
    expect(sam.getByText('Policy · Provider B')).toBeTruthy()
    expect(sam.getByText('Holds it and is covered')).toBeTruthy()
    const alex = within(group('Alex'))
    expect(alex.getByText('Covered')).toBeTruthy()
    expect(alex.getByText('Through their employer')).toBeTruthy()
  })

  it('says plainly when a person has no policy in the list', () => {
    render(<CoverageList matrix={matrix as never} />)
    expect(within(group('Kai')).getByText('No policy in the family list for Kai')).toBeTruthy()
  })

  it('gives a policy nobody is matched to its own group, and keeps it out of the people', () => {
    render(<CoverageList matrix={matrix as never} />)
    expect(
      within(group('Not matched to anyone yet')).getByText('Policy · Test Insurer'),
    ).toBeTruthy()
    expect(within(group('Sam')).queryByText('Policy · Test Insurer')).toBeNull()
  })

  it('has no unmatched group when every policy is matched', () => {
    const matched = { ...matrix, rows: matrix.rows.slice(0, 3) }
    render(<CoverageList matrix={matched as never} />)
    expect(screen.queryByRole('group', { name: 'Not matched to anyone yet' })).toBeNull()
  })

  it('is a labelled region with no table, so nothing scrolls sideways', () => {
    const { container } = render(<CoverageList matrix={matrix as never} />)
    expect(screen.getByRole('region', { name: 'Who is covered by what' })).toBeTruthy()
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('[class*="overflow-x"]')).toBeNull()
  })
})
