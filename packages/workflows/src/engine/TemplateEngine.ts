/**
 * Template engine for workflow nodes.
 * Resolves {{state.x}}, {{event.y}}, {{tenant.z}}, {{env.X}} expressions.
 */

export interface TemplateContext {
  state: Record<string, unknown>
  event: Record<string, unknown>
  tenant: Record<string, unknown>
  env?: Record<string, string>
  nodes?: Record<string, unknown>  // output from previous nodes
}

const TEMPLATE_RE = /\{\{([^}]+)\}\}/g

export function resolveTemplate(template: unknown, ctx: TemplateContext): string {
  if (template === undefined || template === null) return ''
  return String(template).replace(TEMPLATE_RE, (match, expr) => {
    const trimmed = expr.trim()

    // Support {{state.x.y}} → deep path lookup
    const value = resolvePath(trimmed, {
      state: ctx.state,
      event: ctx.event,
      tenant: ctx.tenant,
      env: ctx.env ?? {},
      nodes: ctx.nodes ?? {},
    })

    if (value === undefined || value === null) return match  // keep original if not found
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  })
}

export function resolveTemplateObject<T>(obj: T, ctx: TemplateContext): T {
  if (typeof obj === 'string') return resolveTemplate(obj, ctx) as T
  if (Array.isArray(obj)) return obj.map(item => resolveTemplateObject(item, ctx)) as T
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = resolveTemplateObject(v, ctx)
    }
    return result as T
  }
  return obj
}

function resolvePath(path: string, root: Record<string, unknown>): unknown {
  const parts = path.split('.')
  let current: unknown = root
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/** Extract value from object using simple JSONPath-like expression ($.key.subkey) */
export function extractJsonPath(obj: unknown, path: string): unknown {
  if (!path.startsWith('$.')) return obj
  const parts = path.slice(2).split('.')
  let current = obj
  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/** Parse duration string like "24h", "30m", "1d" → milliseconds */
export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+(?:\.\d+)?)(m|h|d|s)$/)
  if (!match) throw new Error(`Invalid duration: ${duration}`)
  const val = parseFloat(match[1]!)
  const unit = match[2]!
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 }
  return val * (multipliers[unit] ?? 1000)
}
