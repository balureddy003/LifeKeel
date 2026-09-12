import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { EventSchemaRegistry } from '../event-schema-registry.js'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SchemaBody = z.object({
  event_type: z.string().min(1),
  source: z.string().default('custom'),
  schema_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  schema: z.record(z.unknown()),
})

const ConnectorSchemaQuery = z.object({
  connector_id: z.string().optional(),
  event_type: z.string().optional(),
})

export function registerEventSchemaRoutes(app: FastifyInstance, db: Db): void {
  const registry = new EventSchemaRegistry(db)

  // Register custom event schema
  app.post('/event-schemas', async (req, reply) => {
    const parsed = SchemaBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid event schema', issues: parsed.error.issues })
    await registry.register({ tenant_id: req.authContext.tenant_id, ...parsed.data })
    return reply.status(201).send({ registered: true, ...parsed.data })
  })

  // List custom event schemas
  app.get('/event-schemas', async req => ({
    schemas: await db.collection('event_schemas')
      .find({ tenant_id: req.authContext.tenant_id })
      .sort({ event_type: 1, schema_version: -1 })
      .toArray(),
  }))

  // Validate event against schema
  app.post('/event-schemas/validate', async (req, reply) => {
    const parsed = SchemaBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid validation request', issues: parsed.error.issues })
    
    const { event_type, source, schema_version, schema } = parsed.data
    const validationResult = await registry.validate({
      tenant_id: req.authContext.tenant_id,
      event_type,
      source,
      schema_version,
      data: schema as Record<string, unknown>,
    })
    
    return reply.status(validationResult.valid ? 200 : 400).send(validationResult)
  })

  // List connector schemas (from filesystem)
  app.get('/connector-schemas', async (req, reply) => {
    const query = ConnectorSchemaQuery.safeParse(req.query)
    if (!query.success) return reply.status(400).send({ error: 'Invalid query parameters', issues: query.error.issues })

    const connectorSchemas = await loadConnectorSchemas(query.data.connector_id, query.data.event_type)
    return reply.send({ schemas: connectorSchemas })
  })

  // Get specific connector schema
  app.get('/connector-schemas/:connector_id/:event_type', async (req, reply) => {
    const { connector_id, event_type } = req.params as { connector_id: string; event_type: string }
    
    const schemaPath = join(process.cwd(), 'connectors', connector_id, 'schemas', `${event_type}.json`)
    if (!existsSync(schemaPath)) {
      return reply.status(404).send({ error: 'Schema not found' })
    }

    try {
      const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'))
      return reply.send({ connector_id, event_type, schema })
    } catch (err) {
      return reply.status(500).send({ error: 'Failed to load schema', detail: (err as Error).message })
    }
  })

  // List all connectors with schema support
  app.get('/connector-schemas/registry', async (_req, reply) => {
    const connectors = await getConnectorsWithSchemas()
    return reply.send({ connectors })
  })
}

async function loadConnectorSchemas(connectorId?: string, eventType?: string): Promise<Array<{
  connector_id: string
  event_type: string
  schema_version: string
  schema: Record<string, unknown>
}>> {
  const connectorsDir = join(process.cwd(), 'connectors')
  const schemas: Array<{
    connector_id: string
    event_type: string
    schema_version: string
    schema: Record<string, unknown>
  }> = []

  const connectorIds = connectorId ? [connectorId] : readdirSync(connectorsDir).filter(f => f.endsWith('.yaml')).map(f => f.replace('.yaml', ''))

  for (const cid of connectorIds) {
    const schemasDir = join(connectorsDir, cid, 'schemas')
    if (!existsSync(schemasDir)) continue

    const schemaFiles = readdirSync(schemasDir).filter(f => f.endsWith('.json'))
    for (const schemaFile of schemaFiles) {
      const event_type = schemaFile.replace('.json', '')
      if (eventType && event_type !== eventType) continue

      try {
        const schemaPath = join(schemasDir, schemaFile)
        const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'))
        const kairos = schema.kairos as { schema_version?: string } | undefined
        
        schemas.push({
          connector_id: cid,
          event_type,
          schema_version: kairos?.schema_version || '1.0.0',
          schema,
        })
      } catch {
        // Skip invalid schema files
      }
    }
  }

  return schemas
}

async function getConnectorsWithSchemas(): Promise<Array<{
  connector_id: string
  name: string
  schema_count: number
  event_types: string[]
}>> {
  const connectorsDir = join(process.cwd(), 'connectors')
  const connectors: Array<{
    connector_id: string
    name: string
    schema_count: number
    event_types: string[]
  }> = []

  const connectorFiles = readdirSync(connectorsDir).filter(f => f.endsWith('.yaml'))
  for (const connectorFile of connectorFiles) {
    const connectorId = connectorFile.replace('.yaml', '')
    const connectorPath = join(connectorsDir, connectorFile)
    
    try {
      const connectorYaml = readFileSync(connectorPath, 'utf-8')
      const connector = parseConnectorYaml(connectorYaml)
      const schemasDir = join(connectorsDir, connectorId, 'schemas')
      
      let schemaCount = 0
      let eventTypes: string[] = []
      
      if (existsSync(schemasDir)) {
        const schemaFiles = readdirSync(schemasDir).filter(f => f.endsWith('.json'))
        schemaCount = schemaFiles.length
        eventTypes = schemaFiles.map(f => f.replace('.json', ''))
      }

      connectors.push({
        connector_id: connectorId,
        name: connector.name || connectorId,
        schema_count: schemaCount,
        event_types: eventTypes,
      })
    } catch {
      // Skip invalid connector files
    }
  }

  return connectors
}

function parseConnectorYaml(yaml: string): { name?: string } {
  const lines = yaml.split('\n')
  for (const line of lines) {
    const match = line.match(/^name:\s*(.+)$/)
    if (match && match[1]) return { name: match[1].trim() }
  }
  return {}
}
