/**
 * Safe Expression Evaluator
 *
 * Uses `filtrex` — a purpose-built, sandboxed formula evaluator.
 * No eval(). No Function constructor. Whitelisted operators only.
 *
 * Supports:
 *   "data.days_overdue >= 7 and data.amount_minor >= 10000"
 *   "data.churn_risk > 0.8 or data.days_inactive > 30"
 *   "not data.is_trial and data.revenue_minor > 50000"
 *
 * Also handles template interpolation: "Invoice {{data.days_overdue}} days overdue"
 */

import { compileExpression, useDotAccessOperator } from 'filtrex'
import { formatMoney } from '@kairos/platform'

export class EvaluatorError extends Error {
  constructor(
    message: string,
    public readonly expression: string,
  ) {
    super(message)
    this.name = 'EvaluatorError'
  }
}

export class EvaluatorTimeoutError extends Error {
  constructor(
    message: string,
    public readonly expression: string,
    public readonly timeout: number,
  ) {
    super(message)
    this.name = 'EvaluatorTimeoutError'
  }
}

export class EvaluatorComplexityError extends Error {
  constructor(
    message: string,
    public readonly expression: string,
    public readonly complexity: { tokens: number; nestingDepth: number; operatorCount: number },
  ) {
    super(message)
    this.name = 'EvaluatorComplexityError'
  }
}

// ── Smart Expression Cache ──────────────────────────────────────────────────────
// Multi-level cache with TTL and size limits for performance optimization
interface CacheEntry {
  compiled: ReturnType<typeof compileExpression>
  hitCount: number
  lastHit: number
  ttl: number
}

class SmartExpressionCache {
  private l1 = new Map<string, CacheEntry>() // Hot expressions (100 entries)
  private l2 = new Map<string, CacheEntry>() // Warm expressions (1000 entries)
  private readonly l1MaxSize = 100
  private readonly l2MaxSize = 1000
  private readonly l1TTL = 3600000 // 1 hour
  private readonly l2TTL = 7200000 // 2 hours
  private readonly promotionThreshold = 10 // Promote to L1 after 10 hits
  
  get(key: string): ReturnType<typeof compileExpression> | null {
    const now = Date.now()
    
    // Check L1 first (hot cache)
    const l1Entry = this.l1.get(key)
    if (l1Entry && now - l1Entry.lastHit < this.l1TTL) {
      l1Entry.hitCount++
      l1Entry.lastHit = now
      return l1Entry.compiled
    }
    
    // Check L2 (warm cache)
    const l2Entry = this.l2.get(key)
    if (l2Entry && now - l2Entry.lastHit < this.l2TTL) {
      l2Entry.hitCount++
      l2Entry.lastHit = now
      
      // Promote to L1 if hit frequently
      if (l2Entry.hitCount >= this.promotionThreshold) {
        this.l1.set(key, l2Entry)
        this.l2.delete(key)
      }
      return l2Entry.compiled
    }
    
    return null
  }
  
  set(key: string, compiled: ReturnType<typeof compileExpression>): void {
    const now = Date.now()
    const entry: CacheEntry = {
      compiled,
      hitCount: 0,
      lastHit: now,
      ttl: this.l1TTL
    }
    
    // Add to L1 if space available
    if (this.l1.size < this.l1MaxSize) {
      this.l1.set(key, entry)
    } else {
      // L1 full, add to L2
      if (this.l2.size >= this.l2MaxSize) {
        // L2 full, evict least recently used
        let lruKey: string | null = null
        let lruTime = Infinity
        for (const [k, v] of this.l2.entries()) {
          if (v.lastHit < lruTime) {
            lruTime = v.lastHit
            lruKey = k
          }
        }
        if (lruKey) this.l2.delete(lruKey)
      }
      this.l2.set(key, entry)
    }
  }
  
  getStats(): { l1Size: number; l2Size: number; totalHits: number } {
    let totalHits = 0
    for (const entry of this.l1.values()) totalHits += entry.hitCount
    for (const entry of this.l2.values()) totalHits += entry.hitCount
    
    return {
      l1Size: this.l1.size,
      l2Size: this.l2.size,
      totalHits
    }
  }
  
  clear(): void {
    this.l1.clear()
    this.l2.clear()
  }
}

const expressionCache = new SmartExpressionCache()

// Performance metrics
const performanceMetrics = new Map<string, { count: number; totalTime: number; p50: number; p95: number; p99: number }>()

// Complexity limits
const COMPLEXITY_LIMITS = {
  maxTokens: 100,
  maxNestingDepth: 5,
  maxOperators: 20,
} as const

// Default timeout
const DEFAULT_TIMEOUT = 100 // ms

function getCompiledExpression(expression: string): ReturnType<typeof compileExpression> {
  const cached = expressionCache.get(expression)
  if (cached) return cached

  try {
    const compiled = compileExpression(expression, {
      // Required for dot-notation access: data.amount_minor, context.industry, etc.
      customProp: useDotAccessOperator,
      extraFunctions: {
        // Safe numeric helpers
        abs: (x: number) => Math.abs(x),
        min: (a: number, b: number) => Math.min(a, b),
        max: (a: number, b: number) => Math.max(a, b),
        round: (x: number) => Math.round(x),
        floor: (x: number) => Math.floor(x),
        ceil: (x: number) => Math.ceil(x),
        threshold: (
          thresholds: Record<string, unknown> | undefined,
          key: string,
          fallback = 0,
        ) => {
          const value = thresholds?.[key]
          return typeof value === 'number' && Number.isFinite(value) ? value : fallback
        },
        // Safe string helpers
        len: (s: string | unknown[]) => (Array.isArray(s) ? s.length : String(s).length),
        includes: (haystack: string, needle: string) => String(haystack).includes(needle),
        startsWith: (s: string, prefix: string) => String(s).startsWith(prefix),
        lower: (s: string) => String(s).toLowerCase(),
        upper: (s: string) => String(s).toUpperCase(),
        safeGet: (obj: Record<string, unknown>, key: string, fallback: unknown = undefined) =>
          obj && typeof obj === 'object' ? (obj[key] ?? fallback) : fallback,
      },
    })
    expressionCache.set(expression, compiled)
    return compiled
  } catch (err) {
    throw new EvaluatorError(
      `Invalid expression: ${String(err)}`,
      expression,
    )
  }
}

// Export cache stats for monitoring
export function getExpressionCacheStats() {
  return expressionCache.getStats()
}

export function clearExpressionCache() {
  expressionCache.clear()
}

/**
 * Evaluate a filtrex expression against a flattened context object.
 *
 * The context object is passed directly; filtrex accesses nested fields
 * via dot notation: data.amount_minor, context.industry, etc.
 */
export function evaluate(
  expression: string,
  context: Record<string, unknown>,
): boolean {
  const compiled = getCompiledExpression(expression)
  try {
    const result = compiled(context)
    // filtrex returns truthy/falsy; normalise to boolean.
    // A missing property is returned as an Error object rather than thrown,
    // and must be treated as "no evidence" (false) rather than truthy.
    if (result instanceof Error) return false
    return Boolean(result)
  } catch (err) {
    throw new EvaluatorError(
      `Evaluation failed: ${String(err)}`,
      expression,
    )
  }
}

/**
 * Safely evaluate a numeric expression — used for impact calculations.
 * Returns null if evaluation fails (graceful degradation).
 */
export function evaluateNumeric(
  expression: string | number,
  context: Record<string, unknown>,
): number | null {
  if (typeof expression === 'number') return expression
  try {
    const compiled = getCompiledExpression(expression)
    const result = compiled(context)
    if (typeof result === 'number' && isFinite(result)) return result
    return null
  } catch {
    return null
  }
}

/**
 * Interpolate a template string: "Invoice {{data.days_overdue}} days overdue"
 * Falls back to raw template if field not found.
 */
/**
 * Rounds a raw interpolated number to a sensible display precision — whole
 * numbers stay whole, everything else gets exactly 2 decimal places.
 * Without this, `String(value)` on a raw computed number (e.g. a portfolio
 * weight or an excess-share count from float division) surfaced whatever
 * floating-point precision the arithmetic happened to produce — reasoning
 * text like "makes up 17.3% of the portfolio" next to another card's
 * "29.49%", or worse, "sell 3978.01919374 shares of DPW_US_EQ". Doesn't
 * touch pre-formatted string fields (e.g. `data.current_price_gbp`) since
 * those aren't `typeof 'number'` in the template context.
 */
function formatInterpolatedNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (Number.isInteger(n)) return String(n)
  return (Math.round(n * 100) / 100).toFixed(2)
}

// Fields named `*_minor` are minor-unit money amounts (pence/cents) by
// convention throughout this codebase. A sum/difference/scalar-multiple of
// `_minor` fields is still money ("mortgage + education gap" is a pound
// amount), but a *ratio* of them isn't — dividing one money field by
// another produces a unitless count (e.g. "months of expenses covered"),
// not an amount, so division specifically is excluded here.
function looksLikeMoney(path: string): boolean {
  return /_minor\b/.test(path) && !path.includes('/')
}

export function interpolate(
  template: string,
  context: Record<string, unknown>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
    const trimmedPath = path.trim()
    let value = resolvePath(trimmedPath, context)
    if (value === undefined || value === null) {
      // Not a plain dot-path — some older detector templates embed a small
      // calculation directly (e.g. "{{data.target_age - data.current_age}}")
      // instead of pre-computing it server-side. resolvePath only does
      // single-field lookups, so this used to render as the literal
      // unresolved "{{...}}" text straight to the customer. Fall back to
      // evaluating it as a filtrex expression, same engine already used for
      // rule conditions and impact calculations.
      const computed = evaluateNumeric(trimmedPath, context)
      if (computed === null) return `{{${path}}}`
      value = computed
    }
    if (typeof value !== 'number') return String(value)
    if (looksLikeMoney(trimmedPath)) return formatMoney(value)
    return formatInterpolatedNumber(value)
  })
}

/**
 * Resolve a dot-path string against a nested object.
 * "data.amount_minor" → context.data.amount_minor
 */
function resolvePath(path: string, obj: Record<string, unknown>): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
}

export interface ExpressionValidationResult {
  valid: boolean
  error?: string
}

/**
 * Validate that an expression is syntactically correct without evaluating it.
 * Returns a rich result with an error message when the expression is invalid.
 */
export function isValidExpression(expression: string): ExpressionValidationResult {
  try {
    getCompiledExpression(expression)
    return { valid: true }
  } catch (err) {
    return { valid: false, error: String(err) }
  }
}

/**
 * Calculate expression complexity metrics
 */
export function calculateComplexity(expression: string): {
  tokens: number
  nestingDepth: number
  operatorCount: number
} {
  const tokens = expression.split(/\s+/).filter(t => t.length > 0)
  const operators = expression.match(/[&|><=!+\-*/()]/g) || []
  
  // Calculate nesting depth (parentheses)
  let depth = 0
  let maxDepth = 0
  for (const char of expression) {
    if (char === '(') {
      depth++
      maxDepth = Math.max(maxDepth, depth)
    } else if (char === ')') {
      depth--
    }
  }

  return {
    tokens: tokens.length,
    nestingDepth: maxDepth,
    operatorCount: operators.length,
  }
}

/**
 * Validate expression complexity against limits
 */
export function validateComplexity(expression: string): {
  valid: boolean
  complexity: ReturnType<typeof calculateComplexity>
  error?: string
} {
  const complexity = calculateComplexity(expression)
  
  if (complexity.tokens > COMPLEXITY_LIMITS.maxTokens) {
    return {
      valid: false,
      complexity,
      error: `Expression exceeds token limit (${complexity.tokens} > ${COMPLEXITY_LIMITS.maxTokens})`,
    }
  }
  
  if (complexity.nestingDepth > COMPLEXITY_LIMITS.maxNestingDepth) {
    return {
      valid: false,
      complexity,
      error: `Expression exceeds nesting depth limit (${complexity.nestingDepth} > ${COMPLEXITY_LIMITS.maxNestingDepth})`,
    }
  }
  
  if (complexity.operatorCount > COMPLEXITY_LIMITS.maxOperators) {
    return {
      valid: false,
      complexity,
      error: `Expression exceeds operator limit (${complexity.operatorCount} > ${COMPLEXITY_LIMITS.maxOperators})`,
    }
  }
  
  return { valid: true, complexity }
}

/**
 * Evaluate expression with timeout protection
 */
export async function evaluateWithTimeout(
  expression: string,
  context: Record<string, unknown>,
  timeout = DEFAULT_TIMEOUT,
): Promise<boolean> {
  const compiled = getCompiledExpression(expression)
  
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new EvaluatorTimeoutError(
        `Expression evaluation timed out after ${timeout}ms`,
        expression,
        timeout,
      ))
    }, timeout)

    try {
      const result = compiled(context)
      clearTimeout(timer)
      resolve(Boolean(result))
    } catch (err) {
      clearTimeout(timer)
      reject(new EvaluatorError(
        `Evaluation failed: ${String(err)}`,
        expression,
      ))
    }
  })
}

/**
 * Evaluate expression with performance tracking
 */
export function evaluateWithMetrics(
  expression: string,
  context: Record<string, unknown>,
): { result: boolean; duration: number } {
  const startTime = performance.now()
  const compiled = getCompiledExpression(expression)
  
  try {
    const result = compiled(context)
    const duration = performance.now() - startTime
    
    // Update metrics
    const metrics = performanceMetrics.get(expression) || {
      count: 0,
      totalTime: 0,
      p50: 0,
      p95: 0,
      p99: 0,
    }
    metrics.count++
    metrics.totalTime += duration
    
    // Simple percentile approximation (in production, use proper percentile calculation)
    if (duration > metrics.p99) metrics.p99 = duration
    if (duration > metrics.p95) metrics.p95 = duration
    if (duration > metrics.p50) metrics.p50 = duration
    
    performanceMetrics.set(expression, metrics)
    
    return { result: Boolean(result), duration }
  } catch (err) {
    const duration = performance.now() - startTime
    throw new EvaluatorError(
      `Evaluation failed: ${String(err)}`,
      expression,
    )
  }
}

/**
 * Get performance metrics for an expression
 */
export function getExpressionMetrics(expression: string) {
  return performanceMetrics.get(expression) || {
    count: 0,
    totalTime: 0,
    p50: 0,
    p95: 0,
    p99: 0,
  }
}

/**
 * Get all expression performance metrics
 */
export function getAllExpressionMetrics() {
  return Object.fromEntries(performanceMetrics)
}

/**
 * Clear performance metrics
 */
export function clearExpressionMetrics() {
  performanceMetrics.clear()
}
