import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { useScrollIntoViewWhen } from '../useScrollIntoViewWhen'

// Opening a form that renders below the fold looked like nothing had happened.
function Probe({ open }: { open: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useScrollIntoViewWhen(ref, open)
  return open ? <div ref={ref} data-testid="form" /> : null
}

afterEach(cleanup)

describe('useScrollIntoViewWhen', () => {
  it('scrolls the element into view when it opens', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const { rerender } = render(<Probe open={false} />)
    expect(scroll).not.toHaveBeenCalled()
    rerender(<Probe open />)
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
  })

  it('does not scroll again on later renders while it stays open', () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    const { rerender } = render(<Probe open />)
    rerender(<Probe open />)
    expect(scroll).toHaveBeenCalledTimes(1)
  })

  it('does nothing where scrollIntoView does not exist', () => {
    // @ts-expect-error simulate an environment without it
    delete Element.prototype.scrollIntoView
    expect(() => render(<Probe open />)).not.toThrow()
  })
})
