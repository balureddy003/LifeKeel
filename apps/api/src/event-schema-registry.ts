import type { Db } from 'mongodb'

export interface EventSchemaValidation {
  valid: boolean
  registered: boolean
  errors: Array<{ path: string; message: string }>
}

export class EventSchemaRegistry {
  constructor(private readonly db: Db) {}

  async register(input: {
    tenant_id: string
    event_type: string
    source: string
    schema_version: string
    schema: Record<string, unknown>
  }): Promise<void> {
    await this.db.collection('event_schemas').updateOne(
      {
        tenant_id: input.tenant_id,
        event_type: input.event_type,
        source: input.source,
        schema_version: input.schema_version,
      },
      { $set: { ...input, updated_at: new Date() } },
      { upsert: true },
    )
  }

  async validate(input: {
    tenant_id: string
    event_type: string
    source: string
    schema_version: string
    data: Record<string, unknown>
  }): Promise<EventSchemaValidation> {
    const record = await this.db.collection('event_schemas').findOne({
      tenant_id: input.tenant_id,
      event_type: input.event_type,
      source: input.source,
      schema_version: input.schema_version,
    })
    if (!record) return { valid: true, registered: false, errors: [] }
    const schema = record['schema'] as Record<string, unknown>
    const errors: EventSchemaValidation['errors'] = []
    const required = Array.isArray(schema['required']) ? schema['required'] as string[] : []
    const properties = (schema['properties'] ?? {}) as Record<string, { type?: string }>
    for (const field of required) {
      if (!(field in input.data)) errors.push({ path: field, message: 'is required' })
    }
    for (const [field, definition] of Object.entries(properties)) {
      if (!(field in input.data) || !definition.type) continue
      const actual = Array.isArray(input.data[field]) ? 'array' : typeof input.data[field]
      if (actual !== definition.type) errors.push({ path: field, message: `expected ${definition.type}, received ${actual}` })
    }
    return { valid: errors.length === 0, registered: true, errors }
  }
}
