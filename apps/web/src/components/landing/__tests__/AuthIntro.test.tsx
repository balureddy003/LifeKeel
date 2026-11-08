import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthIntro } from '../AuthIntro'

describe('signup panel', () => {
  it('starts the family list, in four plain steps, when nothing else was picked', () => {
    render(<AuthIntro variant="signup" />)
    expect(screen.getByRole('heading', { name: 'Your family list starts here.' })).toBeTruthy()
    for (const t of [
      'Create your account',
      'Add one thing',
      'Ask every adult to look',
      'Find it when you need it',
    ])
      expect(screen.getByText(t)).toBeTruthy()
    expect(screen.getByText('A car, a policy or a school date')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/figures|months|\bbrief\b/i)
  })

  it('keeps the money path when a question was picked, in plain words', () => {
    render(<AuthIntro variant="signup" problem="Our mortgage fix is ending" />)
    expect(
      screen.getByRole('heading', { name: 'Your question: Our mortgage fix is ending.' }),
    ).toBeTruthy()
    expect(screen.getByText('Enter a few figures')).toBeTruthy()
    expect(screen.getByText('Send the link')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\bbrief\b/i)
  })

  it('no longer pitches the vault set-up steps', () => {
    render(<AuthIntro variant="signup" />)
    expect(screen.queryByText(/home base|Policies, accounts and papers/i)).toBeNull()
  })
})

describe('sign-in panel', () => {
  it('welcomes people back to the family list, not to money accounts', () => {
    render(<AuthIntro variant="login" />)
    expect(screen.getByText('KNOW WHERE TO LOOK')).toBeTruthy()
    expect(screen.getByText('The list')).toBeTruthy()
    expect(screen.getByText('Policies, cars and school dates')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Accounts in one view/)
  })
})
