/**
 * CloudStorageSyncEngine
 *
 * Extends the file ingestor to work with cloud storage providers:
 *   - Google Drive  (Drive API v3)
 *   - OneDrive      (Microsoft Graph)
 *   - Dropbox       (Dropbox API v2)
 *
 * Flow per sync cycle:
 *   1. List files in the watched folder (changed since last sync)
 *   2. Download each CSV/XLSX/JSON file
 *   3. Parse via FileIngestor (auto-detect schema or use saved column mapping)
 *   4. Pass events to engine.evaluate()
 *   5. Persist insights + update sync state
 *
 * Column mappings per connector are stored in MongoDB under
 * { tenant_id, connector_id, file_name_pattern, column_mapping }
 * so the user only configures once per file type.
 */

import { FileIngestor } from './file-ingestor.js'
import type { ColumnMapping, ParsedEvent } from './file-ingestor.js'
import type { Engine, Insight } from '@agentoak/engine'
import { safeFetch } from './safe-fetch.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { collection: (name: string) => any }

interface CloudCredentials {
  tenant_id: string
  connector_id: string
  auth_type: 'oauth2'
  access_token: string
  refresh_token?: string
  token_expires_at?: Date
  extra?: Record<string, string>
}

interface FileEntry {
  id: string
  name: string
  modified_at: Date
  size_bytes: number
  download_url?: string | undefined
}

interface FileSyncState {
  tenant_id: string
  connector_id: string
  file_id: string
  file_name: string
  last_synced_at: Date
  last_modified_at: Date
  rows_processed: number
  insights_triggered: number
}

interface ColumnMappingConfig {
  tenant_id: string
  connector_id: string
  /** Glob pattern to match file names, e.g. "invoices*.csv" */
  file_name_pattern: string
  event_type: string
  column_mapping: ColumnMapping[]
  created_at: Date
}

const SYNCABLE_EXTENSIONS = ['.csv', '.tsv', '.xlsx', '.xls', '.json', '.ndjson', '.jsonl']

function isSyncable(filename: string): boolean {
  const lower = filename.toLowerCase()
  return SYNCABLE_EXTENSIONS.some(ext => lower.endsWith(ext))
}

function matchesPattern(filename: string, pattern: string): boolean {
  // Simple glob: * matches any characters
  const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i')
  return regex.test(filename)
}

export class CloudStorageSyncEngine {
  private readonly db: Db
  private readonly ingestor: FileIngestor
  private readonly engine: Engine

  constructor(db: Db, engine: Engine) {
    this.db = db
    this.ingestor = new FileIngestor()
    this.engine = engine
  }

  // ─── Auth headers ──────────────────────────────────────────────────────────

  private bearerHeader(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` }
  }

  // ─── File listing per provider ─────────────────────────────────────────────

  private async listGoogleDriveFiles(
    creds: CloudCredentials,
    since?: Date,
  ): Promise<FileEntry[]> {
    const files: FileEntry[] = []
    let pageToken: string | undefined

    const sinceClause = since
      ? ` and modifiedTime > '${since.toISOString()}'`
      : ''
    const q = encodeURIComponent(
      `(mimeType='text/csv' or mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or mimeType='application/json') and trashed=false${sinceClause}`,
    )

    do {
      const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,modifiedTime,size),nextPageToken&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`
      const res = await safeFetch(url, { headers: this.bearerHeader(creds.access_token) })
      if (!res.ok) break
      const data = await res.json() as {
        files: Array<{ id: string; name: string; modifiedTime: string; size?: string }>
        nextPageToken?: string
      }
      for (const f of data.files) {
        if (!isSyncable(f.name)) continue
        files.push({
          id: f.id,
          name: f.name,
          modified_at: new Date(f.modifiedTime),
          size_bytes: parseInt(f.size ?? '0'),
          download_url: `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`,
        })
      }
      pageToken = data.nextPageToken
    } while (pageToken)

    return files
  }

  private async listOneDriveFiles(
    creds: CloudCredentials,
    since?: Date,
  ): Promise<FileEntry[]> {
    const files: FileEntry[] = []
    const filterClause = since
      ? `&$filter=lastModifiedDateTime gt ${since.toISOString()}`
      : ''
    // Search for syncable files
    const url = `https://graph.microsoft.com/v1.0/me/drive/search(q='.csv .xlsx .json')?$select=id,name,lastModifiedDateTime,size,@microsoft.graph.downloadUrl${filterClause}&$top=100`
    const res = await safeFetch(url, { headers: this.bearerHeader(creds.access_token) })
    if (!res.ok) return files
    const data = await res.json() as {
      value: Array<{
        id: string
        name: string
        lastModifiedDateTime: string
        size?: number
        '@microsoft.graph.downloadUrl'?: string
      }>
    }
    for (const f of data.value ?? []) {
      if (!isSyncable(f.name)) continue
      files.push({
        id: f.id,
        name: f.name,
        modified_at: new Date(f.lastModifiedDateTime),
        size_bytes: f.size ?? 0,
        download_url: f['@microsoft.graph.downloadUrl'],
      })
    }
    return files
  }

  private async listDropboxFiles(
    creds: CloudCredentials,
    since?: Date,
  ): Promise<FileEntry[]> {
    const stateCol = this.db.collection('cloud_storage_cursors')
    const storedCursor = await stateCol.findOne({
      tenant_id: creds.tenant_id,
      connector_id: creds.connector_id,
    }) as { cursor?: string } | null

    const files: FileEntry[] = []

    if (storedCursor?.cursor) {
      // Use longpoll cursor to get only changes
      const res = await safeFetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cursor: storedCursor.cursor }),
      })
      if (!res.ok) return files
      const data = await res.json() as {
        entries: Array<{ '.tag': string; id: string; name: string; client_modified: string; size?: number }>
        cursor: string
      }
      for (const entry of data.entries ?? []) {
        if (entry['.tag'] !== 'file' || !isSyncable(entry.name)) continue
        if (since && new Date(entry.client_modified) < since) continue
        files.push({ id: entry.id, name: entry.name, modified_at: new Date(entry.client_modified), size_bytes: entry.size ?? 0 })
      }
      await stateCol.updateOne(
        { tenant_id: creds.tenant_id, connector_id: creds.connector_id },
        { $set: { cursor: data.cursor, updated_at: new Date() } },
        { upsert: true },
      )
    } else {
      // First time — list all files
      const res = await safeFetch('https://api.dropboxapi.com/2/files/list_folder', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: creds.extra?.['folder_path'] ?? '', recursive: true }),
      })
      if (!res.ok) return files
      const data = await res.json() as {
        entries: Array<{ '.tag': string; id: string; name: string; client_modified: string; size?: number }>
        cursor: string
      }
      for (const entry of data.entries ?? []) {
        if (entry['.tag'] !== 'file' || !isSyncable(entry.name)) continue
        files.push({ id: entry.id, name: entry.name, modified_at: new Date(entry.client_modified), size_bytes: entry.size ?? 0 })
      }
      await stateCol.updateOne(
        { tenant_id: creds.tenant_id, connector_id: creds.connector_id },
        { $set: { cursor: data.cursor, updated_at: new Date() } },
        { upsert: true },
      )
    }
    return files
  }

  async listFiles(creds: CloudCredentials, since?: Date): Promise<FileEntry[]> {
    switch (creds.connector_id) {
      case 'google_drive': return this.listGoogleDriveFiles(creds, since)
      case 'onedrive': return this.listOneDriveFiles(creds, since)
      case 'dropbox': return this.listDropboxFiles(creds, since)
      default: return []
    }
  }

  // ─── File download ─────────────────────────────────────────────────────────

  async downloadFile(creds: CloudCredentials, file: FileEntry): Promise<Buffer | null> {
    try {
      if (file.download_url) {
        const res = await safeFetch(file.download_url, { headers: this.bearerHeader(creds.access_token) })
        if (!res.ok) return null
        return Buffer.from(await res.arrayBuffer())
      }

      // Dropbox — use download endpoint
      if (creds.connector_id === 'dropbox') {
        const res = await safeFetch('https://content.dropboxapi.com/2/files/download', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${creds.access_token}`,
            'Dropbox-API-Arg': JSON.stringify({ path: `id:${file.id}` }),
          },
        })
        if (!res.ok) return null
        return Buffer.from(await res.arrayBuffer())
      }

      return null
    } catch {
      return null
    }
  }

  // ─── Column mapping lookup ─────────────────────────────────────────────────

  async getColumnMapping(
    tenantId: string,
    connectorId: string,
    filename: string,
  ): Promise<ColumnMappingConfig | null> {
    const col = this.db.collection('cloud_storage_mappings')
    const configs = await col.find({ tenant_id: tenantId, connector_id: connectorId }).toArray() as ColumnMappingConfig[]
    // Find first pattern that matches the filename
    return configs.find(c => matchesPattern(filename, c.file_name_pattern)) ?? null
  }

  /** Save or update a column mapping for future syncs */
  async saveColumnMapping(config: ColumnMappingConfig): Promise<void> {
    const col = this.db.collection('cloud_storage_mappings')
    await col.updateOne(
      {
        tenant_id: config.tenant_id,
        connector_id: config.connector_id,
        file_name_pattern: config.file_name_pattern,
      },
      { $set: { ...config, updated_at: new Date() } },
      { upsert: true },
    )
  }

  // ─── Process a single file ─────────────────────────────────────────────────

  async processFile(
    creds: CloudCredentials,
    file: FileEntry,
  ): Promise<{ events: number; insights: number }> {
    // Check if we already processed this exact version
    const stateCol = this.db.collection('cloud_file_sync_state')
    const existing = await stateCol.findOne({
      tenant_id: creds.tenant_id,
      connector_id: creds.connector_id,
      file_id: file.id,
    }) as FileSyncState | null

    if (existing && existing.last_modified_at >= file.modified_at) {
      return { events: 0, insights: 0 } // already up to date
    }

    const buffer = await this.downloadFile(creds, file)
    if (!buffer) return { events: 0, insights: 0 }

    // Look up saved column mapping or auto-detect
    const mappingConfig = await this.getColumnMapping(creds.tenant_id, creds.connector_id, file.name)
    const { events } = await this.ingestor.parse(buffer, file.name, {
      tenant_id: creds.tenant_id,
      ...(mappingConfig?.event_type ? { event_type: mappingConfig.event_type } : {}),
      ...(mappingConfig?.column_mapping ? { column_mapping: mappingConfig.column_mapping } : {}),
      backfill: true,
      max_rows: 50_000,
    })

    let insightsCount = 0
    const insightsCol = this.db.collection('insights')

    // Process in batches of 100 to avoid overwhelming the engine
    const BATCH = 100
    for (let i = 0; i < events.length; i += BATCH) {
      const batch = events.slice(i, i + BATCH)
      await Promise.all(batch.map(async (ev: ParsedEvent) => {
        try {
          const result = await this.engine.evaluate({
            event_type: ev.event_type,
            tenant_id: ev.tenant_id,
            event_id: ev.event_id,
            data: ev.data,
          })
          insightsCount += result.insights.length
          if (result.insights.length > 0) {
            const ops = result.insights.map(insight => ({
              updateOne: {
                filter: { id: insight.id },
                update: {
                  $setOnInsert: {
                    ...insight,
                    source: 'cloud_storage',
                    connector_id: creds.connector_id,
                    file_name: file.name,
                    backfill: true,
                  },
                },
                upsert: true,
              },
            }))
            await insightsCol.bulkWrite(ops, { ordered: false })
            await this.ensureVerifiedMoments(result.insights)
          }
        } catch { /* skip bad rows */ }
      }))
    }

    // Update sync state
    await stateCol.updateOne(
      { tenant_id: creds.tenant_id, connector_id: creds.connector_id, file_id: file.id },
      {
        $set: {
          file_name: file.name,
          last_synced_at: new Date(),
          last_modified_at: file.modified_at,
          rows_processed: events.length,
          insights_triggered: insightsCount,
        },
      },
      { upsert: true },
    )

    return { events: events.length, insights: insightsCount }
  }

  private async ensureVerifiedMoments(insights: Insight[]): Promise<void> {
    if (insights.length === 0) return
    const col = this.db.collection('verified_moments')
    await Promise.all([
      col.createIndex({ tenant_id: 1, created_at: -1 }),
      col.createIndex({ tenant_id: 1, insight_id: 1 }, { unique: true }),
      col.createIndex({ tenant_id: 1, goal_id: 1, created_at: -1 }),
      col.createIndex({ tenant_id: 1, status: 1 }),
    ]).catch(() => {})

    const crypto = await import('node:crypto')
    const ops = insights.map((insight) => {
      const record = insight as unknown as Record<string, unknown>
      const features = (record['feature_snapshot'] as Record<string, unknown> | undefined) ?? {}
      const goalId = features['goal_id'] ?? record['goal_id']
      const metric = features['metric'] ?? record['metric']
      const signalIds = [...new Set([...(insight.derived_from_signals ?? []), ...insight.confidence_breakdown.evidence_refs])]
      const id = `vm_${crypto.createHash('sha256').update(`${insight.tenant_id}:${insight.id}`).digest('hex').slice(0, 24)}`
      return {
        updateOne: {
          filter: { tenant_id: insight.tenant_id, insight_id: insight.id },
          update: {
            $setOnInsert: {
              id,
              tenant_id: insight.tenant_id,
              insight_id: insight.id,
              detector_id: insight.detector_id,
              rule_id: insight.rule_id,
              status: 'verified',
              verification_method: 'deterministic_rule',
              signal_ids: signalIds,
              evidence_refs: insight.confidence_breakdown.evidence_refs,
              confidence: insight.confidence_breakdown.or_score,
              hypothesis: insight.hypothesis,
              reasoning: insight.reasoning,
              actions: insight.actions,
              created_at: insight.created_at,
              ...(typeof goalId === 'string' ? { goal_id: goalId } : {}),
              ...(typeof metric === 'string' ? { kpi_metric: metric } : {}),
            },
            $set: {
              updated_at: new Date(),
              signal_ids: signalIds,
              evidence_refs: insight.confidence_breakdown.evidence_refs,
            },
          },
          upsert: true,
        },
      }
    })
    await col.bulkWrite(ops, { ordered: false })
  }

  // ─── Full connector sync ───────────────────────────────────────────────────

  async syncConnector(tenantId: string, connectorId: string): Promise<{
    files_found: number
    files_processed: number
    total_events: number
    total_insights: number
    duration_ms: number
  }> {
    const start = Date.now()
    const credCol = this.db.collection('connector_credentials')
    const creds = await credCol.findOne({
      tenant_id: tenantId,
      connector_id: connectorId,
    }) as CloudCredentials | null

    if (!creds) return { files_found: 0, files_processed: 0, total_events: 0, total_insights: 0, duration_ms: 0 }

    // Get the last sync time to do incremental listing
    const stateCol = this.db.collection('cloud_storage_sync')
    const lastSync = await stateCol.findOne({ tenant_id: tenantId, connector_id: connectorId }) as { last_sync_at: Date } | null

    const files = await this.listFiles(creds, lastSync?.last_sync_at)
    let totalEvents = 0
    let totalInsights = 0
    let processed = 0

    for (const file of files) {
      if (file.size_bytes > 50 * 1024 * 1024) continue // skip files > 50MB
      const result = await this.processFile(creds, file)
      totalEvents += result.events
      totalInsights += result.insights
      if (result.events > 0) processed++
    }

    await stateCol.updateOne(
      { tenant_id: tenantId, connector_id: connectorId },
      { $set: { last_sync_at: new Date(), updated_at: new Date() } },
      { upsert: true },
    )

    return {
      files_found: files.length,
      files_processed: processed,
      total_events: totalEvents,
      total_insights: totalInsights,
      duration_ms: Date.now() - start,
    }
  }
}
