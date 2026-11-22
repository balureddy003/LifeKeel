import { afterEach, describe, expect, it } from 'vitest'
import { isStandalone } from '../platform'

afterEach(() => {
  delete (window as { Capacitor?: unknown }).Capacitor
})

describe('isStandalone', () => {
  it('is false in a plain browser tab', () => {
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia
    expect(isStandalone()).toBe(false)
  })

  it('is true inside the native iOS/Android shell, so push is offered instead of "add to Home Screen"', () => {
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia
    ;(window as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true }
    expect(isStandalone()).toBe(true)
  })
})
