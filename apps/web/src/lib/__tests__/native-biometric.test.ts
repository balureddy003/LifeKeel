/**
 * The Face ID plugin registers natively as "BiometricAuthNative" with checkBiometry and
 * internalAuthenticate (its friendlier BiometricAuth/authenticate wrapper lives in an npm
 * package the remote-loaded web app never bundles). The web side must talk to the native names.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isBiometricAvailable, verifyBiometric } from '../native'

function shellWith(plugins: Record<string, unknown>) {
  ;(window as unknown as { Capacitor: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    Plugins: plugins,
  }
}

afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor
})

describe('native biometric plugin names', () => {
  it('finds Face ID through the native plugin name and unlocks through internalAuthenticate', async () => {
    const internalAuthenticate = vi.fn(async () => {})
    shellWith({
      BiometricAuthNative: {
        checkBiometry: async () => ({ isAvailable: true }),
        internalAuthenticate,
      },
    })
    expect(await isBiometricAvailable()).toBe(true)
    expect(await verifyBiometric('Unlock')).toBe(true)
    expect(internalAuthenticate).toHaveBeenCalledWith({ reason: 'Unlock' })
  })

  it('still works with the wrapper name and authenticate when that is what is present', async () => {
    const authenticate = vi.fn(async () => {})
    shellWith({
      BiometricAuth: { checkBiometry: async () => ({ isAvailable: true }), authenticate },
    })
    expect(await isBiometricAvailable()).toBe(true)
    expect(await verifyBiometric('Unlock')).toBe(true)
    expect(authenticate).toHaveBeenCalled()
  })

  it('is not available, and never unlocks, when the plugin is missing or the person fails the check', async () => {
    shellWith({})
    expect(await isBiometricAvailable()).toBe(false)
    expect(await verifyBiometric('Unlock')).toBe(false)
    shellWith({
      BiometricAuthNative: {
        checkBiometry: async () => ({ isAvailable: true }),
        internalAuthenticate: async () => {
          throw new Error('cancelled')
        },
      },
    })
    expect(await verifyBiometric('Unlock')).toBe(false)
  })
})
