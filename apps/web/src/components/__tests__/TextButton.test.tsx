/** A text-only action still needs a 48px target and readable text. */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { TextButton } from '../TextButton'

afterEach(cleanup)

describe('TextButton', () => {
  it('has a 48px target and text of at least 16px', () => {
    render(<TextButton onClick={() => {}}>Save context</TextButton>)
    const b = screen.getByRole('button', { name: 'Save context' })
    expect(b.className).toContain('min-h-[48px]')
    expect(b.className).toContain('text-base')
    expect(b.className).not.toContain('text-xs')
  })

  it('does not fire while disabled', () => {
    const onClick = vi.fn()
    render(
      <TextButton disabled onClick={onClick}>
        Save context
      </TextButton>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })
})
