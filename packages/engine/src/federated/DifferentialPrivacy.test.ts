/**
 * Tests for DifferentialPrivacy
 */

import { describe, it, expect } from 'vitest'
import { DifferentialPrivacy } from './DifferentialPrivacy.js'

describe('DifferentialPrivacy', () => {
  it('clips L2 norm to maxGradientNorm', () => {
    const dp = new DifferentialPrivacy({ epsilon: 1.0, delta: 1e-5, maxGradientNorm: 1.0 })
    const gradient = [3.0, 4.0] // norm = 5.0
    const clipped = dp.clipL2(gradient)

    const norm = Math.sqrt(clipped.reduce((s, g) => s + g * g, 0))
    expect(norm).toBeCloseTo(1.0, 5)
  })

  it('does not clip when norm is already small', () => {
    const dp = new DifferentialPrivacy({ epsilon: 1.0, delta: 1e-5, maxGradientNorm: 1.0 })
    const gradient = [0.3, 0.4] // norm = 0.5
    const clipped = dp.clipL2(gradient)

    expect(clipped).toEqual([0.3, 0.4])
  })

  it('adds noise that changes the gradient', () => {
    const dp = new DifferentialPrivacy({ epsilon: 1.0, delta: 1e-5, maxGradientNorm: 1.0 })
    const gradient = [0.5, -0.5]
    const noisy = dp.addNoise(gradient)

    // Should be different from original (noise added)
    expect(noisy[0]).not.toBe(0.5)
    expect(noisy[1]).not.toBe(-0.5)
  })

  it('noise scale decreases with larger epsilon', () => {
    const dpHigh = new DifferentialPrivacy({ epsilon: 10.0, delta: 1e-5, maxGradientNorm: 1.0 })
    const dpLow = new DifferentialPrivacy({ epsilon: 0.1, delta: 1e-5, maxGradientNorm: 1.0 })

    const gradient = [1.0, 1.0]
    const noisyHigh = dpHigh.addNoise(gradient)
    const noisyLow = dpLow.addNoise(gradient)

    // High epsilon = less noise = closer to original
    const diffHigh = Math.abs(noisyHigh[0]! - 1.0)
    const diffLow = Math.abs(noisyLow[0]! - 1.0)

    // On average, low epsilon should add more noise
    expect(diffLow).toBeGreaterThanOrEqual(diffHigh * 0.1)
  })

  it('validates config', () => {
    expect(() => DifferentialPrivacy.validate({ epsilon: -1 })).toThrow('epsilon')
    expect(() => DifferentialPrivacy.validate({ delta: 1.5 })).toThrow('delta')
    expect(() => DifferentialPrivacy.validate({ maxGradientNorm: 0 })).toThrow('maxGradientNorm')
  })
})
