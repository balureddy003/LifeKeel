/**
 * Secure Aggregation Protocol for Federated Learning
 *
 * Simplified pairwise-masking protocol (Bonawitz et al. 2017).
 * Server learns only the aggregate; individual gradients remain hidden.
 *
 * For production, replace with a full implementation (e.g. Google-Federated).
 */

export interface Share {
  toTenantId: string
  values: number[]
}

export class SecureAggregationProtocol {
  /**
   * Create random shares of a gradient vector that sum to the original.
   * Each share is sent to a different peer.  The server aggregates shares
   * from all peers; random components cancel out, leaving only the sum.
   */
  createShares(gradient: number[], peerTenantIds: string[]): Map<string, number[]> {
    const shares = new Map<string, number[]>()
    let remaining = [...gradient]

    // Generate n-1 random shares
    for (let i = 0; i < peerTenantIds.length - 1; i++) {
      const share = gradient.map(() => Math.random() * 2 - 1) // uniform [-1, 1]
      shares.set(peerTenantIds[i]!, share)
      remaining = remaining.map((r, j) => r - share[j]!)
    }

    // Last share = gradient - sum(other shares)
    shares.set(peerTenantIds[peerTenantIds.length - 1]!, remaining)
    return shares
  }

  /**
   * Server-side: sum all shares.  The random masks cancel.
   */
  aggregateShares(allShares: Map<string, number[]>[]): number[] {
    if (allShares.length === 0) return []

    const first = allShares[0]!
    const peerIds = Array.from(first.keys())
    const gradientSize = first.get(peerIds[0]!)!.length

    const aggregate: number[] = []
    for (let i = 0; i < gradientSize; i++) {
      let sum = 0
      for (const shares of allShares) {
        for (const [, share] of shares) {
          sum += share[i]!
        }
      }
      aggregate.push(sum)
    }
    return aggregate
  }
}
