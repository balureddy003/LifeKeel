/**
 * Engine metrics (intent 97, slice 1): the event type carries a tenant key, a
 * field class, an outcome and a date — every other field is a closed enum, so a
 * figure, a name or document text cannot be attached by construction. Events go
 * through the platform OTel tracer and the append-only engine_metrics_events
 * collection; a metrics failure never fails the user's request.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getTracer, setTracer, type Span } from '@lifekeel/platform'
import {
  buildEngineMetricEvent,
  emitEngineMetric,
  rollupEngineMetricEvents,
  CONFIRM_LATENCY_BUCKETS,
  ENGINE_METRIC_EVENTS,
  ENGINE_METRICS_RETENTION_DAYS,
} from '../engine-metrics.js'
import { DELETABLE_COLLECTIONS, eraseTenantDataReport } from '../../erasure.js'

const T = 'tenant-a'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('engine-metrics-test')
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})
beforeEach(async () => {
  await db.collection('engine_metrics_events').deleteMany({})
  await db.collection('metrics_daily').deleteMany({})
})

describe('the event builder', () => {
  it('builds a typed event: tenant key, field class, outcome, date — defaults none', () => {
    const doc = buildEngineMetricEvent({
      tenantId: T,
      event: 'extraction_suggested',
      fieldClass: 'net_pay',
      documentCategory: 'income',
    })
    expect(doc).toMatchObject({
      tenant_id: T,
      event: 'extraction_suggested',
      field_class: 'net_pay',
      document_category: 'income',
      check: 'none',
      reason: 'none',
      bucket: 'none',
    })
    expect(doc.at).toBeInstanceOf(Date)
  })

  it('has no free-text field: a figure, a name or document text is refused, not coerced', () => {
    for (const bad of ['£1,234.56', 'Jane Doe', 'the quick brown fox', '123']) {
      expect(() =>
        buildEngineMetricEvent({
          tenantId: T,
          event: 'extraction_confirmed_unchanged',
          fieldClass: bad as never,
        }),
      ).toThrow(/field_class/)
      expect(() => buildEngineMetricEvent({ tenantId: T, event: bad as never })).toThrow(/event/)
      expect(() =>
        buildEngineMetricEvent({
          tenantId: T,
          event: 'extraction_check_failed',
          check: bad as never,
        }),
      ).toThrow(/check/)
      expect(() =>
        buildEngineMetricEvent({
          tenantId: T,
          event: 'figures_confirm_latency',
          bucket: bad as never,
        }),
      ).toThrow(/bucket/)
      expect(() =>
        buildEngineMetricEvent({
          tenantId: T,
          event: 'extraction_suggested',
          documentCategory: bad as never,
        }),
      ).toThrow(/document_category/)
    }
  })

  it('every event kind is reachable and every enum accepts its own members', () => {
    for (const event of ENGINE_METRIC_EVENTS) {
      expect(buildEngineMetricEvent({ tenantId: T, event }).event).toBe(event)
    }
    for (const bucket of CONFIRM_LATENCY_BUCKETS) {
      expect(
        buildEngineMetricEvent({ tenantId: T, event: 'figures_confirm_latency', bucket }).bucket,
      ).toBe(bucket)
    }
  })
})

describe('the source itself carries no free-text surface', () => {
  const src = readFileSync(resolve(__dirname, '../engine-metrics.ts'), 'utf8')

  it('the stored doc type has no bare string field besides the tenant key', () => {
    const body = src.match(/interface EngineMetricDoc \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(body.length).toBeGreaterThan(0)
    // Each field is an enum union, a Date, or the tenant key — nothing can
    // hold a figure, a name, or document text.
    const freeTextFields = body
      .split('\n')
      .filter((l) => /:\s*(string|String)\b/.test(l) && !/tenant_id/.test(l))
    expect(freeTextFields).toEqual([])
    expect(body).toMatch(/tenant_id:\s*string/)
  })

  it('every OTel attribute name the emitter sets is a fixed engine.* key', () => {
    const names = [...src.matchAll(/setAttribute\(\s*'([^']+)'/g)].map((m) => m[1])
    expect(names.length).toBeGreaterThan(0)
    for (const n of names) expect(n).toMatch(/^(engine\.|tenant_id)/)
  })
})

describe('emission', () => {
  const spans: { name: string; attrs: Record<string, unknown> }[] = []
  beforeEach(() => {
    spans.length = 0
    setTracer({
      startSpan(name: string): Span {
        const attrs: Record<string, unknown> = {}
        spans.push({ name, attrs })
        return {
          setAttribute: (k: string, v: string | number | boolean) => {
            attrs[k] = v
          },
          setStatus: () => {},
          recordException: () => {},
          end: () => {},
        }
      },
    })
  })
  afterEach(() => setTracer(getTracer()))

  it('appends one row per event to engine_metrics_events', async () => {
    await emitEngineMetric(db, {
      tenantId: T,
      event: 'extraction_confirmed_unchanged',
      fieldClass: 'net_pay',
      documentCategory: 'income',
    })
    const rows = await db.collection('engine_metrics_events').find({ tenant_id: T }).toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      event: 'extraction_confirmed_unchanged',
      field_class: 'net_pay',
    })
  })

  it('emits an OTel span carrying enum attributes only — no content', async () => {
    await emitEngineMetric(db, {
      tenantId: T,
      event: 'extraction_check_failed',
      fieldClass: 'closing_minor',
      documentCategory: 'banking',
      check: 'balance_does_not_reconcile',
    })
    expect(spans).toHaveLength(1)
    expect(spans[0]!.name).toBe('engine.metric')
    expect(spans[0]!.attrs).toMatchObject({
      tenant_id: T,
      'engine.event': 'extraction_check_failed',
      'engine.field_class': 'closing_minor',
      'engine.document_category': 'banking',
      'engine.check': 'balance_does_not_reconcile',
    })
  })

  it('a failed metrics write resolves instead of throwing — it can never fail a request', async () => {
    const broken = {
      collection: () => ({
        insertOne: async () => {
          throw new Error('mongodb is down')
        },
      }),
    } as never
    await expect(
      emitEngineMetric(broken, { tenantId: T, event: 'extraction_suggested' }),
    ).resolves.toBeUndefined()
  })
})

describe('24-month retention: roll up into aggregate counts, then delete the rows', () => {
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000)

  it('rows older than the window become engine_metric counts in metrics_daily and are deleted', async () => {
    const old = at(ENGINE_METRICS_RETENTION_DAYS + 10)
    const recent = at(30)
    for (let i = 0; i < 3; i++) {
      await emitEngineMetric(db, {
        tenantId: T,
        event: 'extraction_corrected',
        fieldClass: 'net_pay',
        documentCategory: 'income',
        at: old,
      })
    }
    await emitEngineMetric(db, {
      tenantId: T,
      event: 'extraction_suggested',
      fieldClass: 'net_pay',
      documentCategory: 'income',
      at: recent,
    })

    const rolled = await rollupEngineMetricEvents(db)

    expect(await db.collection('engine_metrics_events').countDocuments()).toBe(1)
    const rollups = await db.collection('metrics_daily').find({ metric: 'engine_metric' }).toArray()
    expect(rollups).toHaveLength(1)
    expect(rollups[0]).toMatchObject({ dim: 'extraction_corrected|net_pay|income', count: 3 })
    expect(rollups[0]!['day']).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(rolled).toBe(3)
  })
})

describe('erasure', () => {
  it('engine_metrics_events is tenant-scoped and in the wipe', async () => {
    expect(DELETABLE_COLLECTIONS).toContain('engine_metrics_events')
    await emitEngineMetric(db, { tenantId: T, event: 'extraction_suggested' })
    await emitEngineMetric(db, { tenantId: 'tenant-b', event: 'extraction_suggested' })
    await eraseTenantDataReport(db, T)
    expect(await db.collection('engine_metrics_events').countDocuments({ tenant_id: T })).toBe(0)
    expect(
      await db.collection('engine_metrics_events').countDocuments({ tenant_id: 'tenant-b' }),
    ).toBe(1)
  })
})
