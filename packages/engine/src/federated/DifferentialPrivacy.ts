/**
 * Differential Privacy for Federated Learning
 *
 * Adds calibrated Gaussian noise to gradients before transmission.
 * Based on DP-SGD (Abadi et al., 2016) with Gaussian mechanism.
 */

export interface DPConfig {
  /** Privacy budget epsilon (lower = more private). Typical: 1.0–4.0 */
  epsilon: number
  /** Failure probability delta. Typical: 1e-5 */
  delta: number
  /** L2 norm clipping threshold for gradients. Typical: 1.0 */
  maxGradientNorm: number
}

export class DifferentialPrivacy {
  constructor(private config: DPConfig) {}

  /**
   * Add Gaussian noise to a gradient vector after L2 clipping.
   *
   * Noise scale σ = (maxGradientNorm * sqrt(2 * ln(1.25/δ))) / ε
   */
  addNoise(gradient: number[]): number[] {
    const clipped = this.clipL2(gradient)
    const sigma = this.computeNoiseScale()

    return clipped.map((g) => g + this.gaussianNoise(0, sigma))
  }

  /**
   * Clip gradient to bound L2 sensitivity.
   * If ||gradient||₂ > maxGradientNorm, scale it down.
   */
  clipL2(gradient: number[]): number[] {
    const norm = Math.sqrt(gradient.reduce((sum, g) => sum + g * g, 0))
    if (norm <= this.config.maxGradientNorm || norm === 0) {
      return [...gradient]
    }
    const scale = this.config.maxGradientNorm / norm
    return gradient.map((g) => g * scale)
  }

  /** Compute Gaussian noise standard deviation from privacy budget. */
  private computeNoiseScale(): number {
    const { epsilon, delta, maxGradientNorm } = this.config
    return (maxGradientNorm * Math.sqrt(2 * Math.log(1.25 / delta))) / epsilon
  }

  /** Box–Muller transform for Gaussian random variables. */
  private gaussianNoise(mean: number, std: number): number {
    let u1 = 0
    let u2 = 0
    // Avoid log(0)
    do {
      u1 = Math.random()
      u2 = Math.random()
    } while (u1 === 0)

    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    return mean + z * std
  }

  /** Validate configuration values. */
  static validate(config: Partial<DPConfig>): DPConfig {
    const epsilon = config.epsilon ?? 1.0
    const delta = config.delta ?? 1e-5
    const maxGradientNorm = config.maxGradientNorm ?? 1.0

    if (epsilon <= 0) throw new Error('epsilon must be > 0')
    if (delta <= 0 || delta >= 1) throw new Error('delta must be in (0, 1)')
    if (maxGradientNorm <= 0) throw new Error('maxGradientNorm must be > 0')

    return { epsilon, delta, maxGradientNorm }
  }
}
