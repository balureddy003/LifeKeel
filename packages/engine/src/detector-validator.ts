/**
 * DetectorValidator — fail-fast expression validation at load time
 *
 * Pre-compiles every filtrex expression in a detector config against a
 * representative context. Catches syntax errors at startup rather than
 * silently failing at runtime for the first matching event.
 *
 * Used by Engine.load() — any invalid detector is rejected with a clear
 * diagnostic message that names the detector, rule, and bad expression.
 *
 * ADR-0063: Event Schema Versioning - validates schema version constraints
 */

import { isValidExpression } from './evaluator.js'
import type { DetectorConfig, DetectorRule } from './schemas.js'

// Schema registry is optional and must be injected from a higher tier to avoid
// licence-boundary violations (engine is MIT; workflows is BUSL).
let schemaRegistry: any = null

/**
 * Inject the connector schema registry for ADR-0063 compatibility checks.
 * Apps (not the engine) should call this with the registry from @kairos/workflows.
 */
export function setSchemaRegistry(registry: unknown): void {
  schemaRegistry = registry
}

export interface ValidationError {
  detector_id: string
  rule_id: string
  field: 'condition' | 'suppress_if' | 'impact_low' | 'impact_high' | 'event_types'
  expression: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: string[]
}

export function validateDetector(config: DetectorConfig): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: string[] = []

  if (!config.rules || config.rules.length === 0) {
    warnings.push(`Detector "${config.id}" has no rules — it will never produce insights`)
  }

  // ADR-0063: Validate schema version constraints
  if (config.event_types) {
    for (const eventType of config.event_types) {
      validateSchemaVersionConstraint(config.id, eventType, errors, warnings)
    }
  }

  for (const rule of config.rules) {
    validateRule(config.id, rule, errors, warnings)
  }

  return { valid: errors.length === 0, errors, warnings }
}

function validateSchemaVersionConstraint(
  detectorId: string,
  eventType: { name: string; min_schema_version?: string; max_schema_version?: string },
  errors: ValidationError[],
  warnings: string[],
): void {
  const { name, min_schema_version, max_schema_version } = eventType

  // Validate semver format
  const semverRegex = /^\d+\.\d+\.\d+$/
  if (min_schema_version && !semverRegex.test(min_schema_version)) {
    errors.push({
      detector_id: detectorId,
      rule_id: 'schema_version',
      field: 'event_types',
      expression: `min_schema_version: ${min_schema_version}`,
      message: 'min_schema_version must be in semver format (e.g., 1.0.0)',
    })
  }

  if (max_schema_version && max_schema_version !== '*' && !semverRegex.test(max_schema_version)) {
    errors.push({
      detector_id: detectorId,
      rule_id: 'schema_version',
      field: 'event_types',
      expression: `max_schema_version: ${max_schema_version}`,
      message: 'max_schema_version must be in semver format (e.g., 1.0.0) or "*"',
    })
  }

  // Check if connector schema exists and is compatible
  // Extract connector_id from event type name (e.g., "stripe.charge.succeeded" -> "stripe")
  const connectorId = name.split('.')[0]
  const eventTypeShort = name.split('.').slice(1).join('.')

  if (schemaRegistry) {
    try {
      const compatibility = schemaRegistry.checkCompatibility(
        connectorId,
        eventTypeShort,
        min_schema_version || '0.0.0',
        max_schema_version || '*'
      )

      if (!compatibility.compatible) {
        warnings.push(
          `Detector "${detectorId}" event type "${name}" may have schema compatibility issues: ${compatibility.reason}`
        )
      }
    } catch {
      // Schema registry check failed - skip validation
    }
  }
}

function validateRule(
  detectorId: string,
  rule: DetectorRule,
  errors: ValidationError[],
  warnings: string[],
): void {
  // Condition
  if (typeof rule.condition === 'string') {
    const result = isValidExpression(rule.condition)
    if (!result.valid) {
      errors.push({
        detector_id: detectorId,
        rule_id: rule.id,
        field: 'condition',
        expression: rule.condition,
        message: result.error ?? 'Invalid expression',
      })
    }
  } else if (rule.condition && typeof rule.condition === 'object') {
    validateNestedCondition(detectorId, rule.id, rule.condition, errors)
  }

  // suppress_if
  if (rule.suppress_if) {
    const result = isValidExpression(rule.suppress_if)
    if (!result.valid) {
      errors.push({
        detector_id: detectorId,
        rule_id: rule.id,
        field: 'suppress_if',
        expression: rule.suppress_if,
        message: result.error ?? 'Invalid suppress_if expression',
      })
    }
  }

  // impact expressions (string only; numbers are always valid)
  for (const field of ['impact_low', 'impact_high'] as const) {
    const expr = rule[field]
    if (typeof expr === 'string' && !isNumericLiteral(expr)) {
      const result = isValidExpression(expr)
      if (!result.valid) {
        errors.push({
          detector_id: detectorId,
          rule_id: rule.id,
          field,
          expression: expr,
          message: result.error ?? `Invalid ${field} expression`,
        })
      }
    }
  }

  // Confidence floor
  if (rule.confidence < 0.7) {
    errors.push({
      detector_id: detectorId,
      rule_id: rule.id,
      field: 'condition',
      expression: `confidence = ${rule.confidence}`,
      message: 'Principle I violation: confidence must be ≥ 0.7',
    })
  }

  // Stateful window sanity
  if (rule.state_enabled && !rule.window_size && !rule.window_duration_ms) {
    warnings.push(
      `Rule "${rule.id}" in "${detectorId}" has state_enabled but no window_size or window_duration_ms`,
    )
  }
}

function validateNestedCondition(
  detectorId: string,
  ruleId: string,
  condition: unknown,
  errors: ValidationError[],
): void {
  const cond = condition as {
    expression?: string
    logic_gate?: string
    children?: unknown[]
  }

  if (cond.expression) {
    const result = isValidExpression(cond.expression)
    if (!result.valid) {
      errors.push({
        detector_id: detectorId,
        rule_id: ruleId,
        field: 'condition',
        expression: cond.expression,
        message: result.error ?? 'Invalid nested expression',
      })
    }
  }

  for (const child of cond.children ?? []) {
    validateNestedCondition(detectorId, ruleId, child, errors)
  }
}

function isNumericLiteral(s: string): boolean {
  return !isNaN(Number(s.trim()))
}

export function formatValidationErrors(results: ValidationResult[]): string {
  const all = results.flatMap((r) => r.errors)
  if (all.length === 0) return ''

  const lines = ['Detector validation failed:\n']
  for (const e of all) {
    lines.push(`  ✗ [${e.detector_id}] rule "${e.rule_id}" — ${e.field}: ${e.message}`)
    lines.push(`    Expression: ${e.expression}`)
  }
  return lines.join('\n')
}
