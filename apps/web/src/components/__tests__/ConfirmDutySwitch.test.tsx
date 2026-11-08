/**
 * The organizer's switch for who has to confirm the family list. Added for
 * households where an adult cannot or does not need to confirm (someone the
 * organizer cares for). It names whose and what, says in words what tapping
 * does, and is a 48px target.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { ConfirmDutySwitch } from '../ConfirmDutySwitch'

afterEach(cleanup)

describe('ConfirmDutySwitch', () => {
  it('is a switch named for the person and what it changes', () => {
    render(<ConfirmDutySwitch name="Sam" required onChange={() => {}} />)
    const sw = screen.getByRole('switch', { name: 'Sam confirms the family list' })
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Asked to confirm')).toBeTruthy()
    expect(sw.className).toContain('min-h-[48px]')
  })

  it('says plainly when someone does not need to confirm', () => {
    render(<ConfirmDutySwitch name="Sam" required={false} onChange={() => {}} />)
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('Does not need to confirm')).toBeTruthy()
  })

  it('asks to switch off when on and on when off, without triggering the row it sits in', () => {
    const onChange = vi.fn()
    const rowClick = vi.fn()
    const { rerender } = render(
      <div onClick={rowClick}>
        <ConfirmDutySwitch name="Sam" required onChange={onChange} />
      </div>,
    )
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenLastCalledWith(false)
    rerender(
      <div onClick={rowClick}>
        <ConfirmDutySwitch name="Sam" required={false} onChange={onChange} />
      </div>,
    )
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenLastCalledWith(true)
    expect(rowClick).not.toHaveBeenCalled()
  })

  it('says what tapping it will do, tied to the switch for screen readers', () => {
    const { rerender } = render(<ConfirmDutySwitch name="Sam" required onChange={() => {}} />)
    const on = screen.getByText(/Turn this off if Sam does not need to confirm/)
    expect(screen.getByRole('switch').getAttribute('aria-describedby')).toBe(on.id)
    rerender(<ConfirmDutySwitch name="Sam" required={false} onChange={() => {}} />)
    const off = screen.getByText(/Turn this on to ask Sam to confirm/)
    expect(screen.getByRole('switch').getAttribute('aria-describedby')).toBe(off.id)
  })

  it('does nothing while a change is in flight', () => {
    const onChange = vi.fn()
    render(<ConfirmDutySwitch name="Sam" required busy onChange={onChange} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).not.toHaveBeenCalled()
  })
})
