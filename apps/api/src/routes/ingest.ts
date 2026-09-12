/**
 * Data Ingest Routes
 *
 * POST /ingest/inspect        — upload file, get schema + suggested column mapping
 * POST /ingest/upload         — upload + process file immediately (streaming insights)
 * POST /ingest/upload/stream  — same, streamed via SSE
 *
 * Cloud storage:
 * POST /ingest/cloud/:connectorId/sync   — trigger sync for a cloud storage connector
 * GET  /ingest/cloud/:connectorId/status — sync state + file list
 * POST /ingest/cloud/:connectorId/mapping — save column mapping for a file pattern
 * GET  /ingest/cloud/:connectorId/mapping — list saved mappings
 *
 * Security: all routes require JWT auth. tenant_id from JWT only.
 * File size limit: 50 MB.
 */

import type { FastifyInstance } from 'fastify'
import type { Engine } from '@kairos/engine'
import type { Db } from 'mongodb'
import { FileIngestor } from '@kairos/pipeline'
import { CloudStorageSyncEngine } from '@kairos/pipeline'
import { getInsightsCollection } from '../db.js'
import { persistSignal } from '../signals.js'
import { ensureVerifiedMoments } from '../verified-moments.js'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

// Allowed file extensions for ingest (CSV and JSON only)
const ALLOWED_EXTENSIONS = new Set(['.csv', '.json', '.jsonl', '.tsv', '.txt'])

/**
 * Validate uploaded file by extension and magic number.
 * Prevents upload of executable/binary files disguised as CSV/JSON.
 */
function validateUploadedFile(filename: string, buffer: Buffer): { valid: boolean; reason?: string } {
  // 1. Extension check
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, reason: `File type "${ext}" not allowed. Accepted: CSV, JSON, TSV, TXT.` }
  }

  // 2. Magic number check — reject known executable/binary signatures
  const magic = buffer.subarray(0, 4)
  const isExecutable =
    (magic[0] === 0x4D && magic[1] === 0x5A) || // MZ — Windows PE
    (magic[0] === 0x7F && magic[1] === 0x45 && magic[2] === 0x4C && magic[3] === 0x46) || // ELF
    (magic[0] === 0xCF && magic[1] === 0xFA && magic[2] === 0xED && magic[3] === 0xFE) // Mach-O
  if (isExecutable) {
    return { valid: false, reason: 'Executable files are not allowed' }
  }

  // 3. For JSON, check first non-whitespace char is { or [
  if (ext === '.json' || ext === '.jsonl') {
    const trimmed = buffer.subarray(0, Math.min(buffer.length, 100)).toString('utf8').trimStart()
    if (trimmed.length > 0 && trimmed[0] !== '{' && trimmed[0] !== '[' && trimmed[0] !== '"') {
      return { valid: false, reason: 'File does not contain valid JSON' }
    }
  }

  return { valid: true }
}

export async function registerIngestRoutes(
  app: FastifyInstance,
  engine: Engine,
  db: Db,
): Promise<void> {
  const ingestor = new FileIngestor()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cloudSync = new CloudStorageSyncEngine(db as any, engine)

  // ── POST /ingest/inspect — preview schema before committing ──────────────
  app.post('/ingest/inspect', async (request, reply) => {
    const data = await request.file({ limits: { fileSize: MAX_FILE_SIZE } })
    if (!data) return reply.status(400).send({ error: 'No file uploaded' })

    const buffer = await data.toBuffer()
    const fileCheck = validateUploadedFile(data.filename, buffer)
    if (!fileCheck.valid) return reply.status(400).send({ error: fileCheck.reason })
    const schema = await ingestor.inspect(buffer, data.filename)

    return reply.send({
      filename: data.filename,
      size_bytes: buffer.length,
      ...schema,
    })
  })

  // ── POST /ingest/upload — upload and process, returns insights ───────────
  app.post<{
    Querystring: {
      event_type?: string
      backfill?: string
    }
  }>('/ingest/upload', async (request, reply) => {
    const { tenant_id } = request.authContext
    const data = await request.file({ limits: { fileSize: MAX_FILE_SIZE } })
    if (!data) return reply.status(400).send({ error: 'No file uploaded' })

    const buffer = await data.toBuffer()
    const fileCheck = validateUploadedFile(data.filename, buffer)
    if (!fileCheck.valid) return reply.status(400).send({ error: fileCheck.reason })

    // Column mapping can be passed as a JSON field in the multipart form
    let columnMapping: import('@kairos/pipeline').ColumnMapping[] | undefined
    const mappingField = (request.body as Record<string, unknown>)?.['column_mapping']
    if (typeof mappingField === 'string') {
      try { columnMapping = JSON.parse(mappingField) as import('@kairos/pipeline').ColumnMapping[] } catch { /* ignore */ }
    }

    const { events, schema, skipped } = await ingestor.parse(buffer, data.filename, {
      tenant_id,
      ...(request.query.event_type ? { event_type: request.query.event_type } : {}),
      ...(columnMapping ? { column_mapping: columnMapping } : {}),
      backfill: request.query.backfill !== 'false',
      max_rows: 50_000,
    })

    // Process all events through the engine
    const allInsights: import('@kairos/engine').Insight[] = []
    const BATCH = 50

    for (let i = 0; i < events.length; i += BATCH) {
      const batch = events.slice(i, i + BATCH)
      await Promise.all(batch.map(async ev => {
        try {
          const signalId = await persistSignal({
            tenant_id: ev.tenant_id,
            signal_type: ev.event_type,
            source: ev.source,
            external_id: ev.event_id,
            data: ev.data,
          }, db)
          const result = await engine.evaluate({
            event_type: ev.event_type,
            tenant_id: ev.tenant_id,
            event_id: ev.event_id,
            data: ev.data,
            derived_from_signals: [signalId],
          })
          allInsights.push(...result.insights)
        } catch { /* skip */ }
      }))
    }

    // Persist insights
    if (allInsights.length > 0) {
      const col = await getInsightsCollection()
      const ops = allInsights.map(insight => ({
        updateOne: {
          filter: { id: insight.id },
          update: {
            $setOnInsert: {
              ...insight,
              source: 'file_upload',
              filename: data.filename,
              backfill: true,
            },
          },
          upsert: true,
        },
      }))
      await col.bulkWrite(ops, { ordered: false })
      await ensureVerifiedMoments(db, allInsights)
    }

    return reply.send({
      filename: data.filename,
      size_bytes: buffer.length,
      schema,
      rows_processed: events.length,
      rows_skipped: skipped,
      insights_generated: allInsights.length,
      insights: allInsights.slice(0, 100), // cap response size
    })
  })

  // ── POST /ingest/upload/stream — upload + stream insights via SSE ────────
  app.post('/ingest/upload/stream', async (request, reply) => {
    const { tenant_id } = request.authContext
    const data = await request.file({ limits: { fileSize: MAX_FILE_SIZE } })
    if (!data) return reply.status(400).send({ error: 'No file uploaded' })

    const buffer = await data.toBuffer()
    const fileCheck = validateUploadedFile(data.filename, buffer)
    if (!fileCheck.valid) return reply.status(400).send({ error: fileCheck.reason })
    const { events, schema } = await ingestor.parse(buffer, data.filename, {
      tenant_id,
      backfill: true,
    })

    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const send = (obj: unknown) => reply.raw.write(`data: ${JSON.stringify(obj)}\n\n`)

    send({ type: 'schema', schema, total_rows: events.length })

    let insightsTotal = 0
    for (const ev of events) {
      try {
        const signalId = await persistSignal({
          tenant_id: ev.tenant_id,
          signal_type: ev.event_type,
          source: ev.source,
          external_id: ev.event_id,
          data: ev.data,
        }, db)
        const result = await engine.evaluate({
          event_type: ev.event_type,
          tenant_id: ev.tenant_id,
          event_id: ev.event_id,
          data: ev.data,
          derived_from_signals: [signalId],
        })
        if (result.insights.length > 0) {
          insightsTotal += result.insights.length
          send({ type: 'insights', row: ev.row_index, insights: result.insights })
          // Persist
          const col = await getInsightsCollection()
          await col.bulkWrite(
            result.insights.map(insight => ({
              updateOne: {
                filter: { id: insight.id },
                update: { $setOnInsert: { ...insight, source: 'file_upload', backfill: true } },
                upsert: true,
              },
            })),
            { ordered: false },
          )
          await ensureVerifiedMoments(db, result.insights)
        }
      } catch { /* skip */ }
    }

    send({ type: 'done', rows_processed: events.length, insights_total: insightsTotal })
    reply.raw.end()
  })

  // ── POST /ingest/cloud/:connectorId/sync — trigger cloud storage sync ────
  app.post<{ Params: { connectorId: string } }>(
    '/ingest/cloud/:connectorId/sync',
    async (request, reply) => {
      const { tenant_id } = request.authContext
      const { connectorId } = request.params

      if (!['google_drive', 'onedrive', 'dropbox'].includes(connectorId)) {
        return reply.status(400).send({ error: 'Not a cloud storage connector' })
      }

      // Fire in background, return 202 immediately
      cloudSync.syncConnector(tenant_id, connectorId)
        .then(r => app.log.info({ ...r, tenant_id, connectorId }, 'Cloud sync complete'))
        .catch(err => app.log.error({ err }, 'Cloud sync failed'))

      return reply.status(202).send({
        status: 'sync_started',
        connector_id: connectorId,
        message: 'Sync running in background. Check /ingest/cloud/:connectorId/status for progress.',
      })
    },
  )

  // ── GET /ingest/cloud/:connectorId/status — sync state ───────────────────
  app.get<{ Params: { connectorId: string } }>(
    '/ingest/cloud/:connectorId/status',
    async (request) => {
      const { tenant_id } = request.authContext
      const { connectorId } = request.params

      const syncState = await db.collection('cloud_storage_sync').findOne({
        tenant_id,
        connector_id: connectorId,
      })
      const fileStates = await db.collection('cloud_file_sync_state').find({
        tenant_id,
        connector_id: connectorId,
      }).sort({ last_synced_at: -1 }).limit(50).toArray()

      return {
        connector_id: connectorId,
        last_sync_at: syncState?.['last_sync_at'] ?? null,
        files: fileStates.map((f: Record<string, unknown>) => ({
          file_id: f['file_id'],
          file_name: f['file_name'],
          last_synced_at: f['last_synced_at'],
          last_modified_at: f['last_modified_at'],
          rows_processed: f['rows_processed'],
          insights_triggered: f['insights_triggered'],
        })),
      }
    },
  )

  // ── POST /ingest/cloud/:connectorId/mapping — save column mapping ─────────
  app.post<{
    Params: { connectorId: string }
    Body: {
      file_name_pattern: string
      event_type: string
      column_mapping: import('@kairos/pipeline').ColumnMapping[]
    }
  }>('/ingest/cloud/:connectorId/mapping', async (request, reply) => {
    const { tenant_id } = request.authContext
    const { connectorId } = request.params
    const { file_name_pattern, event_type, column_mapping } = request.body

    await cloudSync.saveColumnMapping({
      tenant_id,
      connector_id: connectorId,
      file_name_pattern,
      event_type,
      column_mapping,
      created_at: new Date(),
    })

    return reply.status(201).send({ ok: true, file_name_pattern })
  })

  // ── GET /ingest/cloud/:connectorId/mapping — list mappings ───────────────
  app.get<{ Params: { connectorId: string } }>(
    '/ingest/cloud/:connectorId/mapping',
    async (request) => {
      const { tenant_id } = request.authContext
      const { connectorId } = request.params
      const mappings = await db.collection('cloud_storage_mappings').find({
        tenant_id,
        connector_id: connectorId,
      }).toArray()
      return { mappings }
    },
  )
}
