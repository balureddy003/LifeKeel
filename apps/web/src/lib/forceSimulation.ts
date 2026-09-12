/**
 * Lightweight force-directed layout simulation.
 *
 * Runs a basic physics simulation with:
 *   - Coulomb repulsion between all nodes (prevents overlap)
 *   - Spring attraction along edges (keeps connected nodes close)
 *   - Centering gravity (pulls everything toward the origin)
 *
 * No external dependencies. Produces stable positions in ~300 ticks.
 */

export interface SimNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  /** fixed mass; heavier nodes move less */
  mass?: number
}

export interface SimEdge {
  source: string
  target: string
}

interface ForceOptions {
  repulsion?: number
  springStrength?: number
  springLength?: number
  centerStrength?: number
  iterations?: number
}

export function runForceSimulation(
  nodes: SimNode[],
  edges: SimEdge[],
  opts: ForceOptions = {},
): Map<string, { x: number; y: number }> {
  const {
    repulsion = 8000,
    springStrength = 0.04,
    springLength = 120,
    centerStrength = 0.01,
    iterations = 300,
  } = opts

  const nodeMap = new Map(nodes.map((n) => [n.id, n]))

  // Seed initial positions in a circle to break symmetry
  const radius = 200
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2
    n.x = Math.cos(angle) * radius
    n.y = Math.sin(angle) * radius
    n.vx = 0
    n.vy = 0
  })

  for (let tick = 0; tick < iterations; tick++) {
    const damping = 1 - tick / (iterations * 1.5)

    // Repulsion: O(n²) but n is small (<30 nodes)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!
        const b = nodes[j]!
        const dx = b.x - a.x
        const dy = b.y - a.y
        const distSq = dx * dx + dy * dy + 0.01
        const dist = Math.sqrt(distSq)
        const force = repulsion / distSq
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        const aMass = a.mass ?? 1
        const bMass = b.mass ?? 1
        a.vx -= fx / aMass
        a.vy -= fy / aMass
        b.vx += fx / bMass
        b.vy += fy / bMass
      }
    }

    // Spring attraction along edges
    for (const edge of edges) {
      const a = nodeMap.get(edge.source)
      const b = nodeMap.get(edge.target)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.01
      const displacement = dist - springLength
      const fx = (dx / dist) * displacement * springStrength
      const fy = (dy / dist) * displacement * springStrength
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }

    // Centering + integration
    for (const n of nodes) {
      n.vx -= n.x * centerStrength
      n.vy -= n.y * centerStrength
      n.x += n.vx * damping
      n.y += n.vy * damping
      n.vx *= damping
      n.vy *= damping
    }
  }

  const result = new Map<string, { x: number; y: number }>()
  for (const n of nodes) {
    result.set(n.id, { x: n.x, y: n.y })
  }
  return result
}
