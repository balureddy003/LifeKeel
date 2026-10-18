/**
 * Tests for Batch Processor
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  BatchProcessor,
  BatchNoveltyTracker,
  BatchChangePointDetector,
  BatchFeatureHashScorer,
  createBatchProcessor,
} from '../calibration/batch-processor.js'

describe('BatchProcessor', () => {
  let processor: BatchProcessor

  beforeEach(() => {
    processor = new BatchProcessor({
      maxBatchSize: 5,
      flushInterval: 1000,
      autoFlush: false,
    })
  })

  afterEach(async () => {
    await processor.destroy()
  })

  it('should add operations to batch', () => {
    processor.add('test-batch', {
      tenantId: 'tenant-1',
      data: { value: 'test' },
      timestamp: Date.now(),
    })

    const stats = processor.getStats()
    expect(stats.batchCount).toBe(1)
    expect(stats.totalOperations).toBe(1)
  })

  it('should auto-flush when batch size exceeded', async () => {
    const processSpy = vi.spyOn(processor as any, 'processBatch').mockResolvedValue(undefined)

    // Add operations up to max batch size
    for (let i = 0; i < 5; i++) {
      processor.add('test-batch', {
        tenantId: 'tenant-1',
        data: { value: i },
        timestamp: Date.now(),
      })
    }

    // Should have auto-flushed
    expect(processSpy).toHaveBeenCalled()
  })

  it('should flush specific batch', async () => {
    const processSpy = vi.spyOn(processor as any, 'processBatch').mockResolvedValue(undefined)

    processor.add('test-batch', {
      tenantId: 'tenant-1',
      data: { value: 'test' },
      timestamp: Date.now(),
    })

    await processor.flush('test-batch')

    expect(processSpy).toHaveBeenCalledWith('test-batch', expect.any(Array))
  })

  it('should flush all batches', async () => {
    const processSpy = vi.spyOn(processor as any, 'processBatch').mockResolvedValue(undefined)

    processor.add('batch-1', { tenantId: 'tenant-1', data: {}, timestamp: Date.now() })
    processor.add('batch-2', { tenantId: 'tenant-2', data: {}, timestamp: Date.now() })

    await processor.flushAll()

    expect(processSpy).toHaveBeenCalledTimes(2)
  })

  it('should get batch statistics', () => {
    processor.add('batch-1', { tenantId: 'tenant-1', data: {}, timestamp: Date.now() })
    processor.add('batch-1', { tenantId: 'tenant-1', data: {}, timestamp: Date.now() })
    processor.add('batch-2', { tenantId: 'tenant-2', data: {}, timestamp: Date.now() })

    const stats = processor.getStats()

    expect(stats.batchCount).toBe(2)
    expect(stats.totalOperations).toBe(3)
    expect(stats.batches['batch-1']).toBe(2)
    expect(stats.batches['batch-2']).toBe(1)
  })

  it('should start and stop auto-flush', async () => {
    const autoFlushProcessor = new BatchProcessor({
      maxBatchSize: 100,
      flushInterval: 100,
      autoFlush: true,
    })

    autoFlushProcessor.add('test-batch', { tenantId: 'tenant-1', data: {}, timestamp: Date.now() })

    // Wait for auto-flush
    await new Promise((resolve) => setTimeout(resolve, 200))

    const stats = autoFlushProcessor.getStats()
    expect(stats.batchCount).toBe(0) // Should have auto-flushed

    autoFlushProcessor.stopAutoFlush()
    await autoFlushProcessor.destroy()
  })
})

describe('BatchNoveltyTracker', () => {
  it('should add novelty observations', () => {
    const mockDb = { collection: vi.fn() } as any
    const mockObserveFn = vi.fn().mockResolvedValue(undefined)

    const tracker = new BatchNoveltyTracker(mockDb, mockObserveFn, {
      maxBatchSize: 10,
      autoFlush: false,
    })

    tracker.addObservation('tenant-1', 'data.amount_minor', '50000')

    const stats = tracker.getStats()
    expect(stats.totalOperations).toBe(1)
  })

  it('should process batch of novelty observations', async () => {
    const mockDb = { collection: vi.fn() } as any
    const mockObserveFn = vi.fn().mockResolvedValue(undefined)

    const tracker = new BatchNoveltyTracker(mockDb, mockObserveFn, {
      maxBatchSize: 10, // Increase to prevent auto-flush
      autoFlush: false,
    })

    tracker.addObservation('tenant-1', 'data.amount_minor', '50000')
    tracker.addObservation('tenant-1', 'data.amount_minor', '60000')
    tracker.addObservation('tenant-1', 'data.amount_minor', '70000')

    await tracker.flush('tenant-1:data.amount_minor')

    expect(mockObserveFn).toHaveBeenCalledTimes(3)
  })
})

describe('BatchChangePointDetector', () => {
  it('should add change-point observations', () => {
    const mockDb = { collection: vi.fn() } as any
    const mockUpdateFn = vi.fn().mockResolvedValue(undefined)

    const detector = new BatchChangePointDetector(mockDb, mockUpdateFn, {
      maxBatchSize: 10,
      autoFlush: false,
    })

    detector.addObservation('tenant-1', 'data.revenue_minor', 50000)

    const stats = detector.getStats()
    expect(stats.totalOperations).toBe(1)
  })

  it('should process batch of change-point observations', async () => {
    const mockDb = { collection: vi.fn() } as any
    const mockUpdateFn = vi.fn().mockResolvedValue(undefined)

    const detector = new BatchChangePointDetector(mockDb, mockUpdateFn, {
      maxBatchSize: 10, // Increase to prevent auto-flush
      autoFlush: false,
    })

    detector.addObservation('tenant-1', 'data.revenue_minor', 50000)
    detector.addObservation('tenant-1', 'data.revenue_minor', 60000)
    detector.addObservation('tenant-1', 'data.revenue_minor', 70000)

    await detector.flush('tenant-1:data.revenue_minor')

    expect(mockUpdateFn).toHaveBeenCalledTimes(3)
  })
})

describe('BatchFeatureHashScorer', () => {
  it('should add feature hash updates', () => {
    const mockDb = { collection: vi.fn() } as any
    const mockUpdateFn = vi.fn().mockResolvedValue(undefined)

    const scorer = new BatchFeatureHashScorer(mockDb, mockUpdateFn, {
      maxBatchSize: 10,
      autoFlush: false,
    })

    scorer.addUpdate('tenant-1', 'detector-1', { industry: 'retail', amount: 'high' }, 1, 0.01)

    const stats = scorer.getStats()
    expect(stats.totalOperations).toBe(1)
  })

  it('should process batch of feature hash updates', async () => {
    const mockDb = { collection: vi.fn() } as any
    const mockUpdateFn = vi.fn().mockResolvedValue(undefined)

    const scorer = new BatchFeatureHashScorer(mockDb, mockUpdateFn, {
      maxBatchSize: 10, // Increase to prevent auto-flush
      autoFlush: false,
    })

    scorer.addUpdate('tenant-1', 'detector-1', { industry: 'retail' }, 1, 0.01)
    scorer.addUpdate('tenant-1', 'detector-1', { industry: 'retail' }, 0, 0.01)
    scorer.addUpdate('tenant-1', 'detector-1', { industry: 'retail' }, 1, 0.01)

    await scorer.flushAll()

    expect(mockUpdateFn).toHaveBeenCalledTimes(3)
    expect(mockUpdateFn).toHaveBeenCalledWith(
      'tenant-1',
      'detector-1',
      { industry: 'retail' },
      1,
      0.01,
    )
  })
})

describe('createBatchProcessor', () => {
  it('should create novelty batch processor', () => {
    const mockDb = { collection: vi.fn() } as any
    const mockUpdateFn = vi.fn().mockResolvedValue(undefined)

    const processor = createBatchProcessor('novelty', mockDb, mockUpdateFn)

    expect(processor).toBeInstanceOf(BatchNoveltyTracker)
  })

  it('should create change-point batch processor', () => {
    const mockDb = { collection: vi.fn() } as any
    const mockUpdateFn = vi.fn().mockResolvedValue(undefined)

    const processor = createBatchProcessor('change-point', mockDb, mockUpdateFn)

    expect(processor).toBeInstanceOf(BatchChangePointDetector)
  })

  it('should create feature hash batch processor', () => {
    const mockDb = { collection: vi.fn() } as any
    const mockUpdateFn = vi.fn().mockResolvedValue(undefined)

    const processor = createBatchProcessor('feature-hash', mockDb, mockUpdateFn)

    expect(processor).toBeInstanceOf(BatchFeatureHashScorer)
  })

  it('should throw error for unknown type', () => {
    const mockDb = { collection: vi.fn() } as any
    const mockUpdateFn = vi.fn().mockResolvedValue(undefined)

    expect(() => {
      createBatchProcessor('unknown' as any, mockDb, mockUpdateFn)
    }).toThrow('Unknown batch processor type')
  })
})
