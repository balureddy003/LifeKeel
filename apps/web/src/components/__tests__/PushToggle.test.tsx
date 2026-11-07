/**
 * The push switch in Settings was 48 by 28 pixels. The visible track can stay
 * small, but the thing a thumb has to hit must be at least 48 by 48.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { PushToggle } from '../PushToggle'

afterEach(cleanup)

describe('PushToggle', () => {
  it('is a named switch with a 48 by 48 target, whatever its state', () => {
    for (const enabled of [false, true]) {
      render(<PushToggle enabled={enabled} onToggle={() => {}} />)
      const sw = screen.getByRole('switch', { name: 'Push notifications' })
      expect(sw.getAttribute('aria-checked')).toBe(String(enabled))
      expect(sw.className).toContain('min-h-[48px]')
      expect(sw.className).toContain('min-w-[48px]')
      cleanup()
    }
  })

  it('toggles when pressed, and not while disabled', () => {
    const onToggle = vi.fn()
    const { rerender } = render(<PushToggle enabled={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onToggle).toHaveBeenCalledTimes(1)
    rerender(<PushToggle enabled={false} disabled onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
