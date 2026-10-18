/**
 * Novelty Tracker — Count-Min Sketch based novelty scoring.
 *
 * Answers: "Have I seen this value before, and how often?"
 * Works on any field of any event type with zero schema knowledge.
 *
 * Algorithm: Count-Min Sketch (Cormode & Muthukrishnan, 2003)
 *   - O(1) insert and query
 *   - Fixed memory: width × depth × 4 bytes (~10KB at default settings)
 *   - Probabilistic: overestimates frequency, never underestimates
 *   - No vocabulary — any string hashes to a bucket
 *
 * Novelty score:
 *   novelty = 1.0  if count == 0  (never seen)
 *   novelty = 1 / log2(count + 2)  (decays as frequency grows)
 *   novelty = 0.0  at count ≥ 1000 (effectively "common")
 *
 * Per-tenant isolation: each tenant gets its own sketch instance,
 * stored in MongoDB as a serialised Uint32Array blob.
 *
 * Usage:
 *   const tracker = new NoveltyTracker(db)
 *   await tracker.load('tenant_abc')
 *   const score = tracker.score('tenant_abc', 'data.amount_minor', '500000')
 *   tracker.observe('tenant_abc', 'data.amount_minor', '500000')
 *   await tracker.flush('tenant_abc')  // persist to MongoDB
 *
 * Injection into EvaluationContext:
 *   context.novelty_scores['data.amount_minor'] = 0.94  (high novelty → rare value)
 *
 * YAML usage:
 *   condition: "data.amount_minor > 0 and context.novelty_scores['data.amount_minor'] > 0.8"
 */

// MongoDB structural type
 
type MongoDb = { collection: (name: string) => any }

// ── Sketch parameters ──────────────────────────────────────────────────────────
const CMS_WIDTH = 1024  // buckets per row — must be power of 2
const CMS_DEPTH = 5     // hash functions (rows) — controls error probability
// Memory per sketch: 1024 × 5 × 4 bytes = 20KB

// ── MurmurHash3 (32-bit) — fast, non-cryptographic ────────────────────────────
// Produces a stable hash for a string + seed. Used to derive CMS_DEPTH indices.
function murmurhash3(str: string, seed: number): number {
  let h = seed >>> 0
  let k: number

  for (let i = 0; i < str.length; i++) {
    k = str.charCodeAt(i)
    k = Math.imul(k, 0xcc9e2d51)
    k = (k << 15) | (k >>> 17)
    k = Math.imul(k, 0x1b873593)
    h ^= k
    h = (h << 13) | (h >>> 19)
    h = (Math.imul(h, 5) + 0xe6546b64) >>> 0
  }

  h ^= str.length
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16

  return h >>> 0
}

// ── CountMinSketch ─────────────────────────────────────────────────────────────

class CountMinSketch {
  readonly table: Uint32Array  // flat: depth × width
  readonly timestamps: Float64Array  // flat: depth × width - last observation timestamp
  private lastDecay: number = Date.now()

  constructor(
    private readonly width = CMS_WIDTH,
    private readonly depth = CMS_DEPTH,
    existing?: Uint32Array,
    existingTimestamps?: Float64Array,
  ) {
    this.table = existing ?? new Uint32Array(width * depth)
    this.timestamps = existingTimestamps ?? new Float64Array(width * depth).fill(Date.now())
  }

  add(item: string, count = 1, timestamp = Date.now()): void {
    for (let d = 0; d < this.depth; d++) {
      const col = murmurhash3(item, d * 0x9e3779b9) % this.width
      const idx = d * this.width + col
      // Saturate at max uint32 to prevent wrapping
      this.table[idx] = Math.min(0xffffffff, (this.table[idx] ?? 0) + count)
      this.timestamps[idx] = timestamp
    }
  }

  query(item: string): number {
    let min = Infinity
    for (let d = 0; d < this.depth; d++) {
      const col = murmurhash3(item, d * 0x9e3779b9) % this.width
      const v = this.table[d * this.width + col] ?? 0
      if (v < min) min = v
    }
    return min === Infinity ? 0 : min
  }

  applyDecay(decayRate: number, currentTime = Date.now()): void {
    const timeSinceDecay = (currentTime - this.lastDecay) / 1000 // seconds
    if (timeSinceDecay < 1) return // Don't decay if less than 1 second

    const decayFactor = Math.exp(-decayRate * timeSinceDecay)
    
    for (let i = 0; i < this.table.length; i++) {
      this.table[i] = Math.floor(this.table[i]! * decayFactor)
    }
    
    this.lastDecay = currentTime
  }

  serialise(): { table: Uint32Array; timestamps: Float64Array; lastDecay: number } {
    return {
      table: this.table,
      timestamps: this.timestamps,
      lastDecay: this.lastDecay,
    }
  }

  static deserialise(data: { table: Uint32Array; timestamps: Float64Array; lastDecay: number }, width = CMS_WIDTH, depth = CMS_DEPTH): CountMinSketch {
    return new CountMinSketch(width, depth, data.table, data.timestamps)
  }
}

// ── Novelty score formula ──────────────────────────────────────────────────────
function noveltyScore(count: number): number {
  if (count === 0) return 1.0
  return Math.max(0, 1 - Math.log2(count + 1) / 10)  // decays to ~0 at count=1023
}

// ── NoveltyTracker ─────────────────────────────────────────────────────────────

export interface NoveltyScore {
  field: string
  value: string
  frequency: number
  novelty: number  // 0 = common, 1 = never seen before
}

export interface NoveltyContext {
  /** Map of "field.path" → novelty score (0–1). Injected into EvaluationContext. */
  scores: Record<string, number>
  /** Highest novelty score across all tracked fields. */
  max_novelty: number
  /** Whether any field has a novelty score above 0.8 (genuinely rare). */
  has_rare_value: boolean
}

export interface NoveltyConfig {
  /** Decay rate for time-weighted novelty (lambda) */
  decay_rate?: number
  /** Decay interval in milliseconds (how often to apply decay) */
  decay_interval_ms?: number
  /** Enable time-weighted novelty */
  enable_decay?: boolean
}

export class NoveltyTracker {
   
  private col: any
  /** In-process sketch cache: tenantId → field → sketch */
  private cache = new Map<string, Map<string, CountMinSketch>>()
  /** Dirty flag: tenantId → field → needs flush */
  private dirty = new Map<string, Set<string>>()
  /** Configuration */
  private config: Required<NoveltyConfig>

  constructor(db: MongoDb, config: NoveltyConfig = {}) {
    this.col = db.collection('novelty_sketches')
    this.col.createIndex({ tenant_id: 1, field: 1 }, { unique: true }).catch(() => {})
    this.config = {
      decay_rate: config.decay_rate ?? 0.1,
      decay_interval_ms: config.decay_interval_ms ?? 3600000, // 1 hour
      enable_decay: config.enable_decay ?? true,
    }
  }

  // ── Load sketches for a tenant from MongoDB ────────────────────────────────

  async load(tenantId: string, fields?: string[]): Promise<void> {
    const query: Record<string, unknown> = { tenant_id: tenantId }
    if (fields) query['field'] = { $in: fields }

    const docs = await this.col.find(query).toArray() as Array<{
      field: string
      table: { buffer: ArrayBuffer } | Uint8Array
      timestamps?: { buffer: ArrayBuffer } | Uint8Array
      last_decay?: number
    }>

    const tenantCache = this.cache.get(tenantId) ?? new Map<string, CountMinSketch>()

    for (const doc of docs) {
      // MongoDB stores binary as Buffer — convert to Uint32Array, preserving byte offsets
      const tableBytes = doc.table instanceof Uint8Array ? doc.table : new Uint8Array(doc.table.buffer)
      const buf = new Uint32Array(tableBytes.buffer, tableBytes.byteOffset, tableBytes.byteLength / 4)

      const timestamps = doc.timestamps
        ? (() => {
            const tsBytes = doc.timestamps instanceof Uint8Array ? doc.timestamps : new Uint8Array(doc.timestamps.buffer)
            return new Float64Array(tsBytes.buffer, tsBytes.byteOffset, tsBytes.byteLength / 8)
          })()
        : undefined

      const serialisedData = {
        table: buf,
        timestamps: timestamps ?? new Float64Array(buf.length).fill(Date.now()),
        lastDecay: doc.last_decay ?? Date.now(),
      }
      
      tenantCache.set(doc.field, CountMinSketch.deserialise(serialisedData))
    }

    this.cache.set(tenantId, tenantCache)
  }

  // ── Score novelty of a specific value ─────────────────────────────────────

  score(tenantId: string, field: string, value: string): NoveltyScore {
    const sketch = this.getSketch(tenantId, field)
    const frequency = sketch.query(value)
    return { field, value, frequency, novelty: noveltyScore(frequency) }
  }

  // ── Observe a value (update the sketch) ───────────────────────────────────

  observe(tenantId: string, field: string, value: string, timestamp = Date.now()): void {
    const sketch = this.getSketch(tenantId, field)
    
    // Apply decay if enabled
    if (this.config.enable_decay) {
      sketch.applyDecay(this.config.decay_rate, timestamp)
    }
    
    sketch.add(value, 1, timestamp)
    // Mark dirty for deferred flush
    const dirtyFields = this.dirty.get(tenantId) ?? new Set<string>()
    dirtyFields.add(field)
    this.dirty.set(tenantId, dirtyFields)
  }

  // ── Apply decay to all sketches for a tenant ───────────────────────────────

  applyDecayToTenant(tenantId: string, currentTime = Date.now()): void {
    if (!this.config.enable_decay) return
    
    const tenantCache = this.cache.get(tenantId)
    if (!tenantCache) return
    
    for (const sketch of tenantCache.values()) {
      sketch.applyDecay(this.config.decay_rate, currentTime)
    }
  }

  // ── Build novelty context for all tracked fields of an event ──────────────

  buildContext(
    tenantId: string,
    data: Record<string, unknown>,
    trackedFields: string[],
  ): NoveltyContext {
    const scores: Record<string, number> = {}

    for (const field of trackedFields) {
      const value = this.extractField(data, field)
      if (value === null) continue
      const result = this.score(tenantId, field, String(value))
      scores[field] = result.novelty
      // Observe after scoring — so the current event doesn't inflate its own novelty
      this.observe(tenantId, field, String(value))
    }

    const values = Object.values(scores)
    const maxNovelty = values.length > 0 ? Math.max(...values) : 0

    return {
      scores,
      max_novelty: maxNovelty,
      has_rare_value: maxNovelty > 0.8,
    }
  }

  // ── Flush dirty sketches to MongoDB ───────────────────────────────────────

  async flush(tenantId: string): Promise<void> {
    const dirtyFields = this.dirty.get(tenantId)
    if (!dirtyFields || dirtyFields.size === 0) return

    const tenantCache = this.cache.get(tenantId)
    if (!tenantCache) return

    const ops = []
    for (const field of dirtyFields) {
      const sketch = tenantCache.get(field)
      if (!sketch) continue
      const serialised = sketch.serialise()
      ops.push(
        this.col.replaceOne(
          { tenant_id: tenantId, field },
          { 
            tenant_id: tenantId, 
            field, 
            table: Buffer.from(serialised.table.buffer),
            timestamps: Buffer.from(serialised.timestamps.buffer),
            last_decay: serialised.lastDecay,
            updated_at: new Date() 
          },
          { upsert: true },
        ),
      )
    }

    await Promise.all(ops)
    this.dirty.get(tenantId)?.clear()
  }

  /** Flush all dirty tenants. Call at end of batch processing. */
  async flushAll(): Promise<void> {
    await Promise.all([...this.dirty.keys()].map(t => this.flush(t)))
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private getSketch(tenantId: string, field: string): CountMinSketch {
    const tenantCache = this.cache.get(tenantId) ?? new Map<string, CountMinSketch>()
    if (!tenantCache.has(field)) {
      tenantCache.set(field, new CountMinSketch())
    }
    this.cache.set(tenantId, tenantCache)
    return tenantCache.get(field)!
  }

  private extractField(data: Record<string, unknown>, dotPath: string): unknown {
    const parts = dotPath.replace(/^data\./, '').split('.')
    let cur: unknown = data
    for (const part of parts) {
      if (cur === null || typeof cur !== 'object') return null
      cur = (cur as Record<string, unknown>)[part]
    }
    return cur ?? null
  }
}