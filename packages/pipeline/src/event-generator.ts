/**
 * Event Generator — The Bridge Between Connectors and the Engine
 *
 * Converts raw connector data (REST responses, webhook payloads) into
 * typed RawEvent documents ready for the Kairos engine.
 *
 * Key guarantees:
 *   1. SHA-256 content-addressed deduplication — zero duplicate events
 *      regardless of connector retry frequency
 *   2. Canonical field mapping — provider-specific fields → standard schema
 *   3. Minor unit normalisation — monetary values always stored as integers
 *   4. tenant_id always from auth context — never from connector data
 */

import crypto from 'node:crypto'
import type { ConnectorConfig, FieldMappingSchema, RawEvent } from './schemas.js'
import type { z } from 'zod'

type FieldMapping = z.infer<typeof FieldMappingSchema>

export interface GenerateOptions {
  connector: ConnectorConfig
  tenant_id: string  // from JWT — never from connector payload
  rows: Record<string, unknown>[]
  source_event_type?: string // override — for webhook use where type is known
}

export interface GenerateResult {
  events: RawEvent[]
  deduplicated: number // count of events skipped due to hash collision
}

export class EventGenerator {
  /**
   * Convert raw connector rows into canonical RawEvent objects.
   * Duplicate events (same hash + tenant_id) are excluded from the result.
   */
  generate(options: GenerateOptions): GenerateResult {
    const { connector, tenant_id, rows, source_event_type } = options
    const events: RawEvent[] = []
    const seenHashes = new Set<string>()
    let deduplicated = 0

    for (const row of rows) {
      // Infer event type
      const sourceType = source_event_type ?? this.inferSourceType(row, connector)
      const eventType = connector.signal_type_map[sourceType] ?? sourceType

      // Apply field mappings
      const mappedData = this.applyFieldMappings(row, connector.field_mappings)

      // Compute deterministic dedup hash
      // SHA-256(tenant_id:connector_id:canonicalJSON)
      const eventHash = this.computeHash(tenant_id, connector.id, mappedData)

      if (seenHashes.has(eventHash)) {
        deduplicated++
        continue
      }
      seenHashes.add(eventHash)

      events.push({
        id: crypto.randomUUID(),
        tenant_id,
        connector_id: connector.id,
        event_type: eventType,
        source_event_type: sourceType,
        raw_data: mappedData,
        event_hash: eventHash,
        received_at: new Date(),
        processed: false,
      })
    }

    return { events, deduplicated }
  }

  /**
   * Convenience method for webhook payloads — single row, known type.
   */
  generateFromWebhook(options: {
    connector: ConnectorConfig
    tenant_id: string
    payload: Record<string, unknown>
    source_event_type: string
  }): RawEvent | null {
    const result = this.generate({
      connector: options.connector,
      tenant_id: options.tenant_id,
      rows: [options.payload],
      source_event_type: options.source_event_type,
    })
    return result.events[0] ?? null
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Infer source event type from row shape + connector config.
   * Iterates signal_type_map keys, checks if row contains matching fields.
   */
  private inferSourceType(
    row: Record<string, unknown>,
    connector: ConnectorConfig,
  ): string {
    for (const [providerType] of Object.entries(connector.signal_type_map)) {
      // Simple heuristic: provider type matches a key in the row
      if (row[providerType] !== undefined) return providerType
      // Or provider type is a substring of any row key
      if (Object.keys(row).some((k) => k.toLowerCase().includes(providerType.toLowerCase()))) {
        return providerType
      }
    }
    return 'data_sync' // fallback
  }

  /**
   * Apply connector field_mappings to raw row.
   * Monetary fields (target ending in _minor) are normalised to integer minor units.
   */
  private applyFieldMappings(
    row: Record<string, unknown>,
    mappings: FieldMapping[],
  ): Record<string, unknown> {
    const result: Record<string, unknown> = { ...row }

    for (const mapping of mappings) {
      const value = this.resolvePath(mapping.source_field, row)
      if (value === undefined) continue

      const transformed = this.applyTransform(value, mapping.transform, mapping.target_field)
      result[mapping.target_field] = transformed
    }

    return result
  }

  private applyTransform(
    value: unknown,
    transform: FieldMapping['transform'],
    targetField: string,
  ): unknown {
    // Auto-detect monetary fields by naming convention
    const isMonetary = targetField.endsWith('_minor') || targetField.endsWith('_pence') || targetField.endsWith('_cents')

    if (transform === 'to_minor_units' || (isMonetary && transform === undefined)) {
      const num = Number(value)
      if (isFinite(num)) return Math.round(num * 100) // dollars → cents
      return 0
    }

    switch (transform) {
      case 'to_string': return String(value)
      case 'to_number': return Number(value)
      case 'to_boolean': return Boolean(value)
      case 'iso_date': return new Date(String(value)).toISOString()
      case 'to_lowercase': return String(value).toLowerCase()
      default: return value
    }
  }

  private resolvePath(path: string, obj: Record<string, unknown>): unknown {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
      return undefined
    }, obj)
  }

  /**
   * SHA-256(tenant_id + connector_id + stable JSON of mapped data)
   * Produces the same hash for identical events regardless of ingestion order.
   */
  private computeHash(
    tenantId: string,
    connectorId: string,
    data: Record<string, unknown>,
  ): string {
    // Recursively sort object keys for stable serialisation.
    // NOTE: JSON.stringify(data, sortedKeys) uses the array as an ALLOWLIST (replacer),
    // not a sorter — nested object keys get silently dropped, causing false deduplication.
    // We must use a reviver-style recursive sort instead.
    const stable = JSON.stringify(this.sortKeysDeep(data))
    const input = `${tenantId}:${connectorId}:${stable}`
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex')
  }

  /** Recursively sort object keys for deterministic JSON serialisation. */
  private sortKeysDeep(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map(v => this.sortKeysDeep(v))
    }
    if (value !== null && typeof value === 'object') {
      const obj = value as Record<string, unknown>
      return Object.keys(obj)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = this.sortKeysDeep(obj[key])
          return acc
        }, {})
    }
    return value
  }
}
