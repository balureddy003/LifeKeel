/**
 * FileIngestor — parse uploaded files (CSV, XLSX, JSON) into LifeKeel events.
 *
 * Supports three ingest modes:
 *
 *  1. AUTO-DETECT  — sniff the column headers and guess the signal type
 *     (invoice, payment, transaction, customer, order, …)
 *
 *  2. SCHEMA MAP   — caller provides { source_col: target_field } mapping
 *     so any spreadsheet shape can be mapped to LifeKeel fields
 *
 *  3. RAW          — emit one event per row with all columns as data fields,
 *     letting the detector YAML do the field extraction
 *
 * Usage:
 *   const ingestor = new FileIngestor()
 *   const { events, schema } = await ingestor.parse(buffer, 'invoices.csv')
 *   // events ready to pass to engine.evaluate()
 */

import Papa from 'papaparse'
import ExcelJS from 'exceljs'
import crypto from 'node:crypto'

export type SupportedFormat = 'csv' | 'tsv' | 'xlsx' | 'xls' | 'json' | 'ndjson'

export interface ColumnMapping {
  /** Source column name in the file */
  source: string
  /** Target LifeKeel field (e.g. "amount_minor", "customer_id", "due_date") */
  target: string
  /** Optional transform */
  transform?: 'to_minor_units' | 'to_string' | 'to_number' | 'iso_date' | 'none'
}

export interface IngestOptions {
  tenant_id: string
  /** Override detected signal type */
  event_type?: string
  /** Explicit column → field mapping */
  column_mapping?: ColumnMapping[]
  /** Which sheet to use for XLSX (default: first) */
  sheet?: string | number
  /** Max rows to process (safety limit, default 50_000) */
  max_rows?: number
  /** Tag all events as backfill so the UI can distinguish them */
  backfill?: boolean
}

export interface ParsedEvent {
  event_type: string
  event_id: string
  tenant_id: string
  data: Record<string, unknown>
  source: 'file_upload'
  backfill: boolean
  row_index: number
}

export interface IngestSchema {
  detected_format: SupportedFormat
  row_count: number
  columns: string[]
  suggested_event_type: string
  suggested_mapping: ColumnMapping[]
  sample_rows: Record<string, unknown>[]
}

// ── Column name normalisation ──────────────────────────────────────────────────

/** Known column aliases → LifeKeel target field */
const COLUMN_ALIASES: Record<string, string> = {
  // Amount / value
  amount: 'amount_minor',
  total: 'amount_minor',
  value: 'amount_minor',
  subtotal: 'amount_minor',
  price: 'amount_minor',
  revenue: 'amount_minor',
  gross: 'amount_minor',
  net: 'amount_minor',
  // IDs
  invoice_id: 'invoice_id',
  invoice_number: 'invoice_id',
  inv_no: 'invoice_id',
  payment_id: 'payment_id',
  transaction_id: 'transaction_id',
  txn_id: 'transaction_id',
  order_id: 'order_id',
  customer_id: 'customer_id',
  client_id: 'customer_id',
  contact_id: 'customer_id',
  account_id: 'customer_id',
  // Dates
  date: 'date',
  created_at: 'date',
  created_date: 'date',
  invoice_date: 'date',
  due_date: 'due_date',
  due: 'due_date',
  payment_date: 'date',
  transaction_date: 'date',
  // Status
  status: 'status',
  state: 'status',
  payment_status: 'status',
  // Description / notes
  description: 'description',
  notes: 'description',
  memo: 'description',
  reference: 'reference',
  // Customer
  customer_name: 'customer_name',
  client_name: 'customer_name',
  company: 'customer_name',
  name: 'customer_name',
  // Currency
  currency: 'currency',
  currency_code: 'currency',
  // Days overdue
  days_overdue: 'days_overdue',
  overdue_days: 'days_overdue',
  // Email
  email: 'email',
  customer_email: 'email',
  // Category
  category: 'category',
  type: 'category',
}

/** Infer event_type from column headers */
function detectEventType(columns: string[]): string {
  const lower = columns.map(c => c.toLowerCase().replace(/[\s_-]/g, '_'))
  const has = (pat: string) => lower.some(c => c.includes(pat))

  if (has('invoice')) return 'invoice.created'
  if (has('payment') && has('fail')) return 'payment.failed'
  if (has('payment')) return 'payment.created'
  if (has('order') && has('abandon')) return 'cart.abandoned'
  if (has('order')) return 'order.created'
  if (has('subscription') || has('plan')) return 'subscription.usage'
  if (has('transaction') || has('bank') || has('txn')) return 'bank.transaction'
  if (has('churn') || has('cancel')) return 'subscription.cancelled'
  if (has('customer') || has('contact')) return 'customer.created'
  if (has('review') || has('rating')) return 'review.submitted'
  if (has('support') || has('ticket')) return 'support.ticket'
  return 'data.imported'
}

/** Build suggested column mapping from file headers */
function suggestMapping(columns: string[]): ColumnMapping[] {
  return columns.map(col => {
    const key = col.toLowerCase().trim().replace(/[\s-]/g, '_')
    const target = COLUMN_ALIASES[key] ?? key
    return {
      source: col,
      target,
      transform: target === 'amount_minor' ? 'to_minor_units' : 'none',
    }
  })
}

// ── Amount normalisation ───────────────────────────────────────────────────────

function toMinorUnits(value: unknown): number {
  const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.-]/g, ''))
  if (isNaN(num)) return 0
  // If already looks like minor units (integer, > 1000 for reasonable amounts), keep as-is
  // Otherwise multiply by 100
  if (Number.isInteger(num) && Math.abs(num) > 999) return num
  return Math.round(num * 100)
}

function applyTransform(value: unknown, transform?: string): unknown {
  if (!transform || transform === 'none') return value
  if (transform === 'to_minor_units') return toMinorUnits(value)
  if (transform === 'to_string') return String(value ?? '')
  if (transform === 'to_number') return parseFloat(String(value)) || 0
  if (transform === 'iso_date') {
    const d = new Date(String(value))
    return isNaN(d.getTime()) ? value : d.toISOString()
  }
  return value
}

// ── Main class ────────────────────────────────────────────────────────────────

export class FileIngestor {

  // ── Format detection ─────────────────────────────────────────────────────

  detectFormat(filename: string, buffer: Buffer): SupportedFormat {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'csv') return 'csv'
    if (ext === 'tsv') return 'tsv'
    if (ext === 'xlsx') return 'xlsx'
    if (ext === 'xls') return 'xls'
    if (ext === 'json') return 'json'
    if (ext === 'ndjson' || ext === 'jsonl') return 'ndjson'
    // Sniff from content
    const head = buffer.slice(0, 4)
    if (head[0] === 0x50 && head[1] === 0x4B) return 'xlsx' // PK zip = xlsx
    try { JSON.parse(buffer.toString('utf-8').trim()); return 'json' } catch { /* not json */ }
    return 'csv'
  }

  // ── Parsers ───────────────────────────────────────────────────────────────

  private parseCsv(buffer: Buffer, delimiter = ','): Record<string, unknown>[] {
    const text = buffer.toString('utf-8')
    const result = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      delimiter,
      skipEmptyLines: true,
      dynamicTyping: true,
      transformHeader: h => h.trim(),
    })
    return result.data
  }

  private async parseXlsx(buffer: Buffer, sheet?: string | number): Promise<Record<string, unknown>[]> {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as any)
    const worksheet = typeof sheet === 'string'
      ? workbook.getWorksheet(sheet)
      : workbook.worksheets[typeof sheet === 'number' ? sheet : 0]
    if (!worksheet) return []
    const rows = worksheet.getRows(1, worksheet.rowCount) ?? []
    if (rows.length === 0) return []
    const headerRow = rows[0]
    if (!headerRow) return []
    const headers = headerRow.values as (string | undefined)[]
    return rows.slice(1).map(row => {
      const obj: Record<string, unknown> = {}
      row.eachCell((cell, colNumber) => {
        const header = headers[colNumber]
        if (header !== undefined) {
          obj[String(header)] = cell.value
        }
      })
      return obj
    })
  }

  private parseJson(buffer: Buffer): Record<string, unknown>[] {
    const text = buffer.toString('utf-8').trim()
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed)) return parsed as Record<string, unknown>[]
    if (typeof parsed === 'object' && parsed !== null) {
      // Try common envelope patterns
      for (const key of ['data', 'items', 'results', 'records', 'rows']) {
        const val = (parsed as Record<string, unknown>)[key]
        if (Array.isArray(val)) return val as Record<string, unknown>[]
      }
      return [parsed as Record<string, unknown>]
    }
    return []
  }

  private parseNdjson(buffer: Buffer): Record<string, unknown>[] {
    return buffer
      .toString('utf-8')
      .split('\n')
      .filter(l => l.trim())
      .map(l => {
        try { return JSON.parse(l) as Record<string, unknown> }
        catch { return null }
      })
      .filter((r): r is Record<string, unknown> => r !== null)
  }

  private async parseRaw(buffer: Buffer, format: SupportedFormat, sheet?: string | number): Promise<Record<string, unknown>[]> {
    switch (format) {
      case 'csv': return this.parseCsv(buffer, ',')
      case 'tsv': return this.parseCsv(buffer, '\t')
      case 'xlsx':
      case 'xls': return await this.parseXlsx(buffer, sheet)
      case 'json': return this.parseJson(buffer)
      case 'ndjson': return this.parseNdjson(buffer)
      default: return this.parseCsv(buffer, ',')
    }
  }

  // ── Schema inspection (call before full parse to show mapping wizard) ─────

  async inspect(buffer: Buffer, filename: string, sheet?: string | number): Promise<IngestSchema> {
    const format = this.detectFormat(filename, buffer)
    const rows = (await this.parseRaw(buffer, format, sheet)).slice(0, 500) // sample only
    const columns = rows.length > 0 ? Object.keys(rows[0] ?? {}) : []
    const suggestedEventType = detectEventType(columns)
    const suggestedMapping = suggestMapping(columns)

    return {
      detected_format: format,
      row_count: rows.length,
      columns,
      suggested_event_type: suggestedEventType,
      suggested_mapping: suggestedMapping,
      sample_rows: rows.slice(0, 5),
    }
  }

  // ── Full parse + event generation ─────────────────────────────────────────

  async parse(
    buffer: Buffer,
    filename: string,
    options: IngestOptions,
  ): Promise<{ events: ParsedEvent[]; schema: IngestSchema; skipped: number }> {
    const format = this.detectFormat(filename, buffer)
    const rows = await this.parseRaw(buffer, format, options.sheet)
    const maxRows = options.max_rows ?? 50_000
    const columns = rows.length > 0 ? Object.keys(rows[0] ?? {}) : []

    const eventType = options.event_type ?? detectEventType(columns)
    const mapping = options.column_mapping ?? suggestMapping(columns)

    // Build lookup: source → { target, transform }
    const mappingLookup = new Map(
      mapping.map(m => [m.source.toLowerCase().trim(), m])
    )

    const events: ParsedEvent[] = []
    let skipped = 0

    for (let i = 0; i < Math.min(rows.length, maxRows); i++) {
      const row = rows[i]
      if (!row) continue

      const data: Record<string, unknown> = {}

      for (const [col, rawVal] of Object.entries(row)) {
        if (rawVal === null || rawVal === undefined || rawVal === '') continue
        const m = mappingLookup.get(col.toLowerCase().trim())
        const target = m?.target ?? col.toLowerCase().replace(/[\s-]/g, '_')
        const value = applyTransform(rawVal, m?.transform)
        data[target] = value
      }

      // Generate deterministic event ID from row content
      const hash = crypto
        .createHash('sha256')
        .update(`${options.tenant_id}:${filename}:${i}:${JSON.stringify(data)}`)
        .digest('hex')
        .substring(0, 16)

      events.push({
        event_type: eventType,
        event_id: `file_${hash}`,
        tenant_id: options.tenant_id,
        data,
        source: 'file_upload',
        backfill: options.backfill ?? true,
        row_index: i,
      })
    }

    skipped = Math.max(0, rows.length - maxRows)

    const schema: IngestSchema = {
      detected_format: format,
      row_count: rows.length,
      columns,
      suggested_event_type: eventType,
      suggested_mapping: mapping,
      sample_rows: rows.slice(0, 5),
    }

    return { events, schema, skipped }
  }
}
