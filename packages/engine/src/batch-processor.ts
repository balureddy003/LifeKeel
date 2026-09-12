/**
 * Batch Processor for ML Components
 *
 * Provides batch processing capabilities for ML components to improve performance
 * by reducing database round-trips and enabling bulk operations.
 *
 * Features:
 *   - Batch novelty tracking observations
 *   - Batch change-point updates
 *   - Batch feature hash scoring
 *   - Configurable batch sizes and flush intervals
 */

// MongoDB types — injected at runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MongoDb = { collection: (name: string) => any }

export interface BatchConfig {
  /** Maximum batch size before auto-flush */
  maxBatchSize?: number
  /** Flush interval in milliseconds */
  flushInterval?: number
  /** Enable auto-flush on interval */
  autoFlush?: boolean
}

export interface BatchOperation<T> {
  tenantId: string
  data: T
  timestamp: number
}

export class BatchProcessor {
  private batches: Map<string, BatchOperation<any>[]> = new Map()
  private flushTimer: NodeJS.Timeout | null = null
  private readonly config: Required<BatchConfig>

  constructor(config: BatchConfig = {}) {
    this.config = {
      maxBatchSize: config.maxBatchSize ?? 100,
      flushInterval: config.flushInterval ?? 5000, // 5 seconds
      autoFlush: config.autoFlush ?? true
    }

    if (this.config.autoFlush) {
      this.startAutoFlush()
    }
  }

  /**
   * Add an operation to a batch
   */
  add<T>(batchKey: string, operation: BatchOperation<T>): void {
    if (!this.batches.has(batchKey)) {
      this.batches.set(batchKey, [])
    }

    const batch = this.batches.get(batchKey)!
    batch.push(operation)

    // Auto-flush if batch size exceeded
    if (batch.length >= this.config.maxBatchSize) {
      this.flush(batchKey).catch(err => {
        console.error(`Failed to flush batch ${batchKey}:`, err)
      })
    }
  }

  /**
   * Flush a specific batch
   */
  async flush(batchKey: string): Promise<void> {
    const batch = this.batches.get(batchKey)
    if (!batch || batch.length === 0) return

    try {
      await this.processBatch(batchKey, batch)
      this.batches.delete(batchKey)
    } catch (err) {
      console.error(`Failed to process batch ${batchKey}:`, err)
      // Keep batch for retry
    }
  }

  /**
   * Flush all batches
   */
  async flushAll(): Promise<void> {
    const promises = Array.from(this.batches.keys()).map(key => this.flush(key))
    await Promise.all(promises)
  }

  /**
   * Get batch statistics
   */
  getStats(): { batchCount: number; totalOperations: number; batches: Record<string, number> } {
    const batches: Record<string, number> = {}
    let totalOperations = 0

    for (const [key, batch] of this.batches.entries()) {
      batches[key] = batch.length
      totalOperations += batch.length
    }

    return {
      batchCount: this.batches.size,
      totalOperations,
      batches
    }
  }

  /**
   * Start auto-flush timer
   */
  private startAutoFlush(): void {
    this.flushTimer = setInterval(async () => {
      await this.flushAll()
    }, this.config.flushInterval)
  }

  /**
   * Stop auto-flush timer
   */
  stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }

  /**
   * Process a batch (to be overridden by specific implementations)
   */
  protected async processBatch(batchKey: string, batch: BatchOperation<any>[]): Promise<void> {
    // Base implementation - override in subclasses
    console.log(`Processing batch ${batchKey} with ${batch.length} operations`)
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    this.stopAutoFlush()
    await this.flushAll()
  }
}

/**
 * Batch Novelty Tracker
 */
export class BatchNoveltyTracker extends BatchProcessor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private col: any
  private observeFn: (tenantId: string, field: string, value: string) => Promise<void>

  constructor(db: MongoDb, observeFn: (tenantId: string, field: string, value: string) => Promise<void>, config?: BatchConfig) {
    super(config)
    this.col = db.collection('novelty_sketches')
    this.observeFn = observeFn
  }

  /**
   * Add novelty observation to batch
   */
  addObservation(tenantId: string, field: string, value: string): void {
    const batchKey = `${tenantId}:${field}`
    this.add(batchKey, {
      tenantId,
      data: { field, value },
      timestamp: Date.now()
    })
  }

  /**
   * Process batch of novelty observations
   */
  protected async processBatch(batchKey: string, batch: BatchOperation<{ field: string; value: string }>[]): Promise<void> {
    const parts = batchKey.split(':')
    const tenantId = parts[0]!
    const field = parts[1] ?? 'default'

    // Process observations in sequence (maintain order)
    for (const op of batch) {
      await this.observeFn(tenantId, op.data.field, op.data.value)
    }
  }
}

/**
 * Batch Change-Point Detector
 */
export class BatchChangePointDetector extends BatchProcessor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private col: any
  private updateFn: (tenantId: string, field: string, value: number) => Promise<any>

  constructor(db: MongoDb, updateFn: (tenantId: string, field: string, value: number) => Promise<any>, config?: BatchConfig) {
    super(config)
    this.col = db.collection('change_point_state')
    this.updateFn = updateFn
  }

  /**
   * Add change-point observation to batch
   */
  addObservation(tenantId: string, field: string, value: number): void {
    const batchKey = `${tenantId}:${field}`
    this.add(batchKey, {
      tenantId,
      data: { field, value },
      timestamp: Date.now()
    })
  }

  /**
   * Process batch of change-point observations
   */
  protected async processBatch(batchKey: string, batch: BatchOperation<{ field: string; value: number }>[]): Promise<void> {
    const parts = batchKey.split(':')
    const tenantId = parts[0]!
    const field = parts[1] ?? 'default'

    // Process observations in sequence (CUSUM requires order)
    for (const op of batch) {
      await this.updateFn(tenantId, op.data.field, op.data.value)
    }
  }
}

/**
 * Batch Feature Hash Scorer
 */
export class BatchFeatureHashScorer extends BatchProcessor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private col: any
  private updateFn: (tenantId: string, detectorId: string, features: Record<string, string>, outcome: number, learningRate: number) => Promise<void>

  constructor(db: MongoDb, updateFn: (tenantId: string, detectorId: string, features: Record<string, string>, outcome: number, learningRate: number) => Promise<void>, config?: BatchConfig) {
    super(config)
    this.col = db.collection('feature_hash_models')
    this.updateFn = updateFn
  }

  /**
   * Add feature hash update to batch
   */
  addUpdate(tenantId: string, detectorId: string, features: Record<string, string>, outcome: number, learningRate = 0.01): void {
    const batchKey = `${tenantId}::${detectorId}`
    this.add(batchKey, {
      tenantId,
      data: { tenantId, detectorId, features, outcome, learningRate },
      timestamp: Date.now()
    })
  }

  /**
   * Process batch of feature hash updates
   */
  protected async processBatch(batchKey: string, batch: BatchOperation<{ tenantId: string; detectorId: string; features: Record<string, string>; outcome: number; learningRate: number }>[]): Promise<void> {
    // Process updates in sequence
    for (const op of batch) {
      const { tenantId, detectorId, features, outcome, learningRate } = op.data
      await this.updateFn(tenantId, detectorId, features, outcome, learningRate)
    }
  }
}

/**
 * Factory function to create batch processors
 */
export function createBatchProcessor(
  type: 'novelty' | 'change-point' | 'feature-hash',
  db: MongoDb,
  updateFn: (...args: any[]) => Promise<any>,
  config?: BatchConfig
): BatchProcessor {
  switch (type) {
    case 'novelty':
      return new BatchNoveltyTracker(db, updateFn as any, config)
    case 'change-point':
      return new BatchChangePointDetector(db, updateFn as any, config)
    case 'feature-hash':
      return new BatchFeatureHashScorer(db, updateFn as any, config)
    default:
      throw new Error(`Unknown batch processor type: ${type}`)
  }
}