import crypto from 'node:crypto'
import type { Db } from 'mongodb'
import { getDb } from './db.js'
import { getSchemaRegistry } from './lib/schema-registry.js'
import { getSignalEnricher } from './lib/signal-enricher.js'
import { createLogger } from '@agentoak/platform'

const log = createLogger({ service: 'signals', version: '0.0.0' })

export interface SignalInput {
  id?: string
  tenant_id: string
  signal_type: string
  source: string
  external_id: string
  data: Record<string, unknown>
  occurred_at?: Date
  received_at?: Date
  schema_version?: string
  event_source?: string
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function computeSignalHash(input: Pick<SignalInput, 'tenant_id' | 'source' | 'external_id' | 'data'>): string {
  return crypto
    .createHash('sha256')
    .update(`${input.tenant_id}:${input.source}:${input.external_id}:${stableJson(input.data)}`, 'utf8')
    .digest('hex')
}

export async function persistSignal(input: SignalInput, dbOverride?: Db): Promise<string> {
  const db = dbOverride ?? await getDb()
  const col = db.collection('signals')
  const id = input.id ?? crypto.randomUUID()
  const now = input.received_at ?? new Date()
  const signal_hash = computeSignalHash(input)

  // Validate against schema registry
  const registry = getSchemaRegistry()
  const validation = registry.validate(input.data, input.signal_type, input.schema_version)
  
  if (!validation.valid) {
    // Log validation errors but still ingest (graceful degradation)
    log.error({ signal_type: input.signal_type, errors: validation.errors }, 'Signal validation failed')
  }

  if (validation.warnings.length > 0) {
    log.warn({ signal_type: input.signal_type, warnings: validation.warnings }, 'Signal validation warnings')
  }

  // Enrich signal data
  const enricher = getSignalEnricher()
  const enrichment = await enricher.enrich(input.data)
  const enrichedData = enrichment.enriched

  await Promise.all([
    col.createIndex({ tenant_id: 1, signal_type: 1, created_at: -1 }),
    col.createIndex({ signal_hash: 1 }, { unique: true }),
  ]).catch(() => {})

  await col.updateOne(
    { signal_hash },
    {
      $setOnInsert: {
        id,
        tenant_id: input.tenant_id,
        signal_type: input.signal_type,
        source: input.source,
        external_id: input.external_id,
        data: enrichedData,
        signal_hash,
        occurred_at: input.occurred_at ?? now,
        created_at: now,
        ingested_at: now,
        schema_version: input.schema_version ?? '0.0.0',
        event_source: input.event_source ?? input.source,
        validation_errors: validation.valid ? undefined : validation.errors,
        validation_warnings: validation.warnings.length > 0 ? validation.warnings : undefined,
        enrichment_metadata: enrichment.enrichment_metadata,
      },
    },
    { upsert: true },
  )

  return id
}
