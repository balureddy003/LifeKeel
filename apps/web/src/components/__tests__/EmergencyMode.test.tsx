/** Emergency Mode: five quick paths, and the other kinds of bad day are named, not hidden. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EmergencyMode } from '../EmergencyMode'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/lib/haptics', () => ({ haptic: vi.fn() }))
vi.mock('../AppHeroHeader', () => ({ AppHeroHeader: () => null }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EmergencyMode', () => {
  it('says details can wait and names job loss and disability', () => {
    render(<EmergencyMode active onDeactivate={vi.fn()} onSelectEvent={vi.fn()} />)
    expect(screen.getByText(/You can add details later/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Job loss, disability/ }))
    expect(push).toHaveBeenCalledWith('/life-events')
  })
})
