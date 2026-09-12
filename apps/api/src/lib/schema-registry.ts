/**
 * Signal Schema Validation Pipeline
 * 
 * Validates incoming signals against registered schemas.
 * Provides graceful degradation for invalid signals.
 */

import { z } from 'zod'

export interface SchemaDefinition {
  signal_type: string
  version: string
  schema: z.ZodSchema
  required_fields: string[]
  optional_fields: string[]
  min_compatible_version?: string
  max_compatible_version?: string
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export interface CompatibilityResult {
  compatible: boolean
  reason?: string
}

export interface SchemaRegistry {
  schemas: Map<string, SchemaDefinition>
  register(schema: SchemaDefinition): void
  get(signalType: string, version?: string): SchemaDefinition | undefined
  validate(signal: Record<string, unknown>, signalType: string, version?: string): ValidationResult
  checkCompatibility(signalType: string, signalVersion: string, detectorVersion: string): CompatibilityResult
}

export class SignalSchemaRegistry implements SchemaRegistry {
  schemas = new Map<string, SchemaDefinition>()

  register(schema: SchemaDefinition): void {
    const key = `${schema.signal_type}:${schema.version}`
    this.schemas.set(key, schema)
  }

  get(signalType: string, version = '0.0.0'): SchemaDefinition | undefined {
    const key = `${signalType}:${version}`
    return this.schemas.get(key)
  }

  validate(signal: Record<string, unknown>, signalType: string, version = '0.0.0'): ValidationResult {
    const schema = this.get(signalType, version)
    
    if (!schema) {
      return {
        valid: false,
        errors: [`No schema registered for signal type: ${signalType} version: ${version}`],
        warnings: [],
      }
    }

    const errors: string[] = []
    const warnings: string[] = []

    // Check required fields
    for (const field of schema.required_fields) {
      if (!(field in signal) || signal[field] === undefined || signal[field] === null) {
        errors.push(`Missing required field: ${field}`)
      }
    }

    // Validate against Zod schema
    try {
      schema.schema.parse(signal)
    } catch (err) {
      if (err instanceof z.ZodError) {
        for (const issue of err.errors) {
          errors.push(`${issue.path.join('.')}: ${issue.message}`)
        }
      } else {
        errors.push(`Schema validation error: ${String(err)}`)
      }
    }

    // Check for unknown fields (warning only)
    const knownFields = new Set([...schema.required_fields, ...schema.optional_fields])
    for (const field of Object.keys(signal)) {
      if (!knownFields.has(field)) {
        warnings.push(`Unknown field: ${field}`)
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }

  checkCompatibility(signalType: string, signalVersion: string, detectorVersion: string): CompatibilityResult {
    const schema = this.get(signalType, signalVersion)
    
    if (!schema) {
      return {
        compatible: false,
        reason: `No schema registered for signal type: ${signalType} version: ${signalVersion}`,
      }
    }

    // Parse versions as semver
    const parseVersion = (v: string): [number, number, number] => {
      const parts = v.split('.').map(Number)
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
    }

    const detectorVer = parseVersion(detectorVersion)
    const minVer = schema.min_compatible_version ? parseVersion(schema.min_compatible_version) : null
    const maxVer = schema.max_compatible_version ? parseVersion(schema.max_compatible_version) : null

    // Check if detector version is within compatible range
    if (minVer) {
      if (detectorVer[0] < minVer[0] || 
          (detectorVer[0] === minVer[0] && detectorVer[1] < minVer[1]) ||
          (detectorVer[0] === minVer[0] && detectorVer[1] === minVer[1] && detectorVer[2] < minVer[2])) {
        return {
          compatible: false,
          reason: `Detector version ${detectorVersion} is below minimum compatible version ${schema.min_compatible_version}`,
        }
      }
    }

    if (maxVer) {
      if (detectorVer[0] > maxVer[0] ||
          (detectorVer[0] === maxVer[0] && detectorVer[1] > maxVer[1]) ||
          (detectorVer[0] === maxVer[0] && detectorVer[1] === maxVer[1] && detectorVer[2] > maxVer[2])) {
        return {
          compatible: false,
          reason: `Detector version ${detectorVersion} is above maximum compatible version ${schema.max_compatible_version}`,
        }
      }
    }

    return { compatible: true }
  }
}

// Global registry instance
let globalRegistry: SignalSchemaRegistry | null = null

export function getSchemaRegistry(): SignalSchemaRegistry {
  if (!globalRegistry) {
    globalRegistry = new SignalSchemaRegistry()
  }
  return globalRegistry
}

export function setSchemaRegistry(registry: SignalSchemaRegistry): void {
  globalRegistry = registry
}
