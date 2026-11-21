/** The secondary home sections fold away (new accounts included) and remember being opened. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { MoreOnHome } from '../MoreOnHome'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('MoreOnHome', () => {
  it('shows children directly for a new account', () => {
    const { container } = render(
      <MoreOnHome fold={false}>
        <p>Family</p>
      </MoreOnHome>,
    )
    expect(container.querySelector('details')).toBeNull()
    expect(screen.getByText('Family')).toBeTruthy()
  })

  it('folds for an account with data, closed by default', () => {
    const { container } = render(
      <MoreOnHome fold>
        <p>Family</p>
      </MoreOnHome>,
    )
    expect(container.querySelector('details')?.open).toBe(false)
    expect(screen.getByText('More about your family')).toBeTruthy()
  })

  it('starts open on a device where it was opened before', () => {
    localStorage.setItem('lk_home_more_open', '1')
    const { container } = render(
      <MoreOnHome fold>
        <p>Family</p>
      </MoreOnHome>,
    )
    expect(container.querySelector('details')?.open).toBe(true)
    fireEvent.click(screen.getByText('More about your family'))
  })

  it('says what is inside when given a hint, so a closed fold is not a mystery', () => {
    render(
      <MoreOnHome fold hint="Family, health and timeline fill in as you add details">
        <p>Family</p>
      </MoreOnHome>,
    )
    expect(screen.getByText(/fill in as you add details/)).toBeTruthy()
  })

  it('shows no hint line when none is given', () => {
    const { container } = render(
      <MoreOnHome fold>
        <p>Family</p>
      </MoreOnHome>,
    )
    expect(container.querySelector('summary')?.textContent).toBe('More about your family')
  })
})
