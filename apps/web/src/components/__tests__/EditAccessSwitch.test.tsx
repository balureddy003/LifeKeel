/**
 * The organizer's edit-access switch: a real switch with a name that says whose
 * and what, honest text for both states, and a 48px target.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { EditAccessSwitch } from '../EditAccessSwitch'

afterEach(cleanup)

describe('EditAccessSwitch', () => {
  it('is a switch named for the person and what it changes, off by default text included', () => {
    render(<EditAccessSwitch name="Alex" enabled={false} onChange={() => {}} />)
    const sw = screen.getByRole('switch', { name: 'Alex can add and change the family list' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('Can only view')).toBeTruthy()
    expect(sw.className).toContain('min-h-[48px]')
  })

  it('asks to turn on when off, and off when on, without triggering the row it sits in', () => {
    const onChange = vi.fn()
    const rowClick = vi.fn()
    const { rerender } = render(
      <div onClick={rowClick}>
        <EditAccessSwitch name="Alex" enabled={false} onChange={onChange} />
      </div>,
    )
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenLastCalledWith(true)
    rerender(
      <div onClick={rowClick}>
        <EditAccessSwitch name="Alex" enabled onChange={onChange} />
      </div>,
    )
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Can edit the family list')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenLastCalledWith(false)
    expect(rowClick).not.toHaveBeenCalled()
  })

  it('says what tapping it will do, in words, tied to the switch for screen readers', () => {
    const { rerender } = render(
      <EditAccessSwitch name="Alex" enabled={false} onChange={() => {}} />,
    )
    const off = screen.getByText('Turn this on to let Alex add and change the family list.')
    expect(screen.getByRole('switch').getAttribute('aria-describedby')).toBe(off.id)
    rerender(<EditAccessSwitch name="Alex" enabled onChange={() => {}} />)
    const on = screen.getByText('Turn this off to make the family list view only for Alex.')
    expect(screen.getByRole('switch').getAttribute('aria-describedby')).toBe(on.id)
  })

  it('does nothing while a change is in flight', () => {
    const onChange = vi.fn()
    render(<EditAccessSwitch name="Alex" enabled={false} busy onChange={onChange} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).not.toHaveBeenCalled()
  })
})
