import { describe, it, expect, vi, afterEach } from 'vitest'
import { haptic } from '../haptics'

type W = { Capacitor?: unknown }

function nativeWith(haptics: {
  impact: ReturnType<typeof vi.fn>
  notification: ReturnType<typeof vi.fn>
}) {
  ;(window as unknown as W).Capacitor = {
    isNativePlatform: () => true,
    Plugins: { Haptics: haptics },
  }
}

afterEach(() => {
  delete (window as unknown as W).Capacitor
})

describe('haptic() in the native shell', () => {
  it('uses the real Taptic engine for taps', () => {
    const h = { impact: vi.fn().mockResolvedValue(undefined), notification: vi.fn() }
    nativeWith(h)
    haptic('light')
    haptic('heavy')
    expect(h.impact).toHaveBeenNthCalledWith(1, { style: 'LIGHT' })
    expect(h.impact).toHaveBeenNthCalledWith(2, { style: 'HEAVY' })
  })

  it('uses notification feedback for success, warning and error', () => {
    const h = { impact: vi.fn(), notification: vi.fn().mockResolvedValue(undefined) }
    nativeWith(h)
    haptic('success')
    haptic('warning')
    haptic('error')
    expect(h.notification.mock.calls.map((c) => c[0].type)).toEqual(['SUCCESS', 'WARNING', 'ERROR'])
    expect(h.impact).not.toHaveBeenCalled()
  })

  it('does nothing extra in a plain browser', () => {
    expect(() => haptic('light')).not.toThrow()
  })
})
