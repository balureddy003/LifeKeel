/**
 * Connector Schema Registry
 *
 * Provides schema validation and compatibility checking for connector events.
 * Integrates with ADR-0063 event schema versioning requirements.
 *
 * ADR-0063: Event Schema Versioning and Connector Contracts
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export interface ConnectorSchema {
  connector_id: string
  event_type: string
  schema_version: string
  signal_type: string
  min_schema_version: string
  schema: Record<string, unknown>
}

export interface SchemaCompatibility {
  compatible: boolean
  reason?: string
  required_version?: string
}

export class ConnectorSchemaRegistry {
  private readonly connectorsDir: string
  private schemaCache = new Map<string, ConnectorSchema>()

  constructor(connectorsDir?: string) {
    this.connectorsDir = connectorsDir || join(process.cwd(), 'connectors')
  }

  /**
   * Load a schema for a specific connector event
   */
  loadSchema(connectorId: string, eventType: string): ConnectorSchema | null {
    const cacheKey = `${connectorId}:${eventType}`
    if (this.schemaCache.has(cacheKey)) {
      return this.schemaCache.get(cacheKey)!
    }

    const schemaPath = join(this.connectorsDir, connectorId, 'schemas', `${eventType}.json`)
    if (!existsSync(schemaPath)) {
      return null
    }

    try {
      const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'))
      const lifekeel = schema.lifekeel as {
        connector_id?: string
        event_type?: string
        schema_version?: string
        signal_type?: string
        min_schema_version?: string
      } | undefined

      const connectorSchema: ConnectorSchema = {
        connector_id: lifekeel?.connector_id || connectorId,
        event_type: lifekeel?.event_type || eventType,
        schema_version: lifekeel?.schema_version || '1.0.0',
        signal_type: lifekeel?.signal_type || eventType,
        min_schema_version: lifekeel?.min_schema_version || '1.0.0',
        schema,
      }

      this.schemaCache.set(cacheKey, connectorSchema)
      return connectorSchema
    } catch (err) {
      console.error(`Failed to load schema for ${connectorId}:${eventType}`, err)
      return null
    }
  }

  /**
   * Check if a detector's schema version requirements are compatible with a connector schema
   */
  checkCompatibility(
    connectorId: string,
    eventType: string,
    detectorMinVersion: string,
    detectorMaxVersion: string = '*'
  ): SchemaCompatibility {
    const schema = this.loadSchema(connectorId, eventType)
    if (!schema) {
      return {
        compatible: false,
        reason: `No schema found for ${connectorId}:${eventType}`,
      }
    }

    const schemaVersion = schema.schema_version
    const minVersion = schema.min_schema_version

    // Check if detector's minimum version is compatible with schema's minimum
    if (!this.isVersionCompatible(detectorMinVersion, minVersion)) {
      return {
        compatible: false,
        reason: `Detector requires schema version >= ${detectorMinVersion}, but connector requires >= ${minVersion}`,
        required_version: minVersion,
      }
    }

    // Check if detector's maximum version constraint is satisfied
    if (detectorMaxVersion !== '*' && !this.isVersionCompatible(schemaVersion, detectorMaxVersion)) {
      return {
        compatible: false,
        reason: `Connector schema version ${schemaVersion} exceeds detector maximum ${detectorMaxVersion}`,
        required_version: detectorMaxVersion,
      }
    }

    return { compatible: true }
  }

  /**
   * Get all schemas for a connector
   */
  getConnectorSchemas(connectorId: string): ConnectorSchema[] {
    const schemas: ConnectorSchema[] = []
    const schemasDir = join(this.connectorsDir, connectorId, 'schemas')
    
    if (!existsSync(schemasDir)) {
      return schemas
    }

    const schemaFiles = readdirSync(schemasDir).filter(f => f.endsWith('.json'))
    for (const schemaFile of schemaFiles) {
      const eventType = schemaFile.replace('.json', '')
      const schema = this.loadSchema(connectorId, eventType)
      if (schema) {
        schemas.push(schema)
      }
    }

    return schemas
  }

  /**
   * Get all connectors with schema support
   */
  getConnectorsWithSchemas(): Array<{
    connector_id: string
    schema_count: number
    event_types: string[]
  }> {
    const connectors: Array<{
      connector_id: string
      schema_count: number
      event_types: string[]
    }> = []

    const connectorFiles = readdirSync(this.connectorsDir).filter(f => f.endsWith('.yaml'))
    for (const connectorFile of connectorFiles) {
      const connectorId = connectorFile.replace('.yaml', '')
      const schemas = this.getConnectorSchemas(connectorId)
      
      if (schemas.length > 0) {
        connectors.push({
          connector_id: connectorId,
          schema_count: schemas.length,
          event_types: schemas.map(s => s.event_type),
        })
      }
    }

    return connectors
  }

  /**
   * Validate event data against schema
   */
  validateEvent(connectorId: string, eventType: string, data: Record<string, unknown>): {
    valid: boolean
    errors: Array<{ path: string; message: string }>
  } {
    const schema = this.loadSchema(connectorId, eventType)
    if (!schema) {
      return {
        valid: true, // No schema = pass validation
        errors: [],
      }
    }

    const errors: Array<{ path: string; message: string }> = []
    const schemaObj = schema.schema as { required?: string[]; properties?: Record<string, { type?: string }> }
    const required = schemaObj.required || []
    const properties = schemaObj.properties || {}

    // Check required fields
    for (const field of required) {
      if (!(field in data)) {
        errors.push({ path: field, message: 'is required' })
      }
    }

    // Check field types
    for (const [field, definition] of Object.entries(properties)) {
      if (!(field in data) || !definition.type) continue
      const actual = Array.isArray(data[field]) ? 'array' : typeof data[field]
      const expected = definition.type
      const isInteger = (value: unknown) => typeof value === 'number' && Number.isInteger(value)
      if (expected === 'integer') {
        if (!isInteger(data[field])) {
          errors.push({ path: field, message: `expected integer, received ${actual}` })
        }
      } else if (actual !== expected) {
        errors.push({ path: field, message: `expected ${expected}, received ${actual}` })
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  /**
   * Clear schema cache (useful for testing or hot-reload)
   */
  clearCache(): void {
    this.schemaCache.clear()
  }

  /**
   * Simple semver compatibility check
   * Returns true if versionA >= versionB
   */
  private isVersionCompatible(versionA: string, versionB: string): boolean {
    const partsA = versionA.split('.').map(Number)
    const partsB = versionB.split('.').map(Number)

    for (let i = 0; i < 3; i++) {
      const a = partsA[i] || 0
      const b = partsB[i] || 0
      if (a > b) return true
      if (a < b) return false
    }

    return true // Equal versions are compatible
  }
}

// Singleton instance
export const connectorSchemaRegistry = new ConnectorSchemaRegistry()
