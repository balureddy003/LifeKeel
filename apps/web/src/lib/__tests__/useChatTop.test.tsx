import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { useChatTop } from '../useChatTop'

// The chat box is sized to the space left under whatever sits above it. When a banner (verify
// email, offline) pushed it down, the fixed header-height sum left the message box under the nav.
function Probe() {
  const ref = useRef<HTMLDivElement>(null)
  useChatTop(ref)
  return <div ref={ref} data-testid="chat" />
}

afterEach(cleanup)

describe('useChatTop', () => {
  it('records where the chat really starts, banner included', () => {
    const orig = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = () => ({ top: 200 }) as DOMRect
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    const { getByTestId } = render(<Probe />)
    expect(getByTestId('chat').style.getPropertyValue('--app-chat-top')).toBe('200px')
    HTMLElement.prototype.getBoundingClientRect = orig
  })

  it('adds the scroll offset so the figure does not depend on where the page is scrolled', () => {
    const orig = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = () => ({ top: 80 }) as DOMRect
    Object.defineProperty(window, 'scrollY', { value: 120, configurable: true })
    const { getByTestId } = render(<Probe />)
    expect(getByTestId('chat').style.getPropertyValue('--app-chat-top')).toBe('200px')
    HTMLElement.prototype.getBoundingClientRect = orig
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
  })
})

describe('chat height rule', () => {
  it('uses the measured top, falling back to the header height', () => {
    const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')
    const rule = css.split('\n').find((l) => l.startsWith('.app-chat {')) ?? ''
    expect(rule).toContain('var(--app-chat-top, var(--app-header-height))')
  })
})
