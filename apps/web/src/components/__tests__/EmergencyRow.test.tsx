import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const activateEmergency = vi.fn()
let show = true
vi.mock('@/lib/mode-context', () => ({
  useMode: () => ({ config: { showEmergencyButton: show }, activateEmergency }),
}))
import { EmergencyRow } from '../EmergencyRow'

describe('EmergencyRow', () => {
  beforeEach(() => {
    activateEmergency.mockClear()
    show = true
  })
  it('opens Emergency mode in one tap', () => {
    render(<EmergencyRow />)
    fireEvent.click(screen.getByRole('button', { name: /Something has happened/ }))
    expect(activateEmergency).toHaveBeenCalledTimes(1)
  })
  it('is absent where the mode hides emergency entry', () => {
    show = false
    const { container } = render(<EmergencyRow />)
    expect(container.firstChild).toBeNull()
  })
})
