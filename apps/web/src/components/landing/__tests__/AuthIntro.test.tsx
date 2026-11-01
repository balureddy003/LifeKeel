import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthIntro } from '../AuthIntro'

describe('signup panel', () => {
  it('names the problem the visitor picked and shows the brief steps', () => {
    render(<AuthIntro variant="signup" problem="Our mortgage fix is ending" />)
    expect(
      screen.getByRole('heading', { name: 'Your brief: Our mortgage fix is ending.' }),
    ).toBeTruthy()
    expect(screen.getByText('Enter a few figures')).toBeTruthy()
    expect(screen.getByText('Send the link')).toBeTruthy()
  })

  it('no longer pitches the vault set-up steps', () => {
    render(<AuthIntro variant="signup" />)
    expect(screen.getByRole('heading', { name: 'Your first brief is next.' })).toBeTruthy()
    expect(screen.queryByText(/home base|Policies, accounts and papers/i)).toBeNull()
  })
})
