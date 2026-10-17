/**
 * Database Index Management
 *
 * Creates and manages MongoDB compound indexes for optimal query performance.
 * These indexes are critical for high-throughput evaluation scenarios.
 *
 * Key indexes:
 *   - tenant_signal_field_time: For adaptive threshold aggregation
 *   - tenant_signal_time: For signal queries with time filters
 *   - tenant_created: For insight queries by tenant and creation time
 *   - detector_tenant: For detector lookups by tenant
 */

// MongoDB types — injected at runtime
 
type MongoDb = { collection: (name: string) => any }

export interface IndexDefinition {
  name: string
  keys: Record<string, 1 | -1>
  options?: {
    unique?: boolean
    sparse?: boolean
    background?: boolean
    partialFilterExpression?: Record<string, unknown>
  }
}

export class DatabaseIndexManager {
   
  private db: any

  constructor(db: MongoDb) {
    this.db = db
  }

  /**
   * Create all required indexes for the LifeKeel engine
   */
  async createAllIndexes(): Promise<void> {
    await this.createSignalIndexes()
    await this.createInsightIndexes()
    await this.createAdaptiveThresholdIndexes()
    await this.createNoveltyTrackerIndexes()
    await this.createChangePointIndexes()
    await this.createFeatureHashIndexes()
    await this.createCalibrationIndexes()
  }

  /**
   * Create indexes for signal collection (used in adaptive thresholds)
   */
  private async createSignalIndexes(): Promise<void> {
    const collection = this.db.collection('signals')

    // Primary index for adaptive threshold aggregation
    await collection.createIndex(
      { tenant_id: 1, signal_type: 1, field: 1, created_at: -1 },
      { 
        name: 'tenant_signal_field_time',
        background: true 
      }
    )

    // Index for signal queries by tenant and type
    await collection.createIndex(
      { tenant_id: 1, signal_type: 1, created_at: -1 },
      { 
        name: 'tenant_signal_time',
        background: true 
      }
    )

    // Index for signal queries by tenant only
    await collection.createIndex(
      { tenant_id: 1, created_at: -1 },
      { 
        name: 'tenant_created',
        background: true 
      }
    )
  }

  /**
   * Create indexes for insights collection
   */
  private async createInsightIndexes(): Promise<void> {
    const collection = this.db.collection('insights')

    // Index for insight queries by tenant and creation time
    await collection.createIndex(
      { tenant_id: 1, created_at: -1 },
      { 
        name: 'tenant_created',
        background: true 
      }
    )

    // Index for insight queries by detector
    await collection.createIndex(
      { detector_id: 1, tenant_id: 1, created_at: -1 },
      { 
        name: 'detector_tenant_created',
        background: true 
      }
    )

    // Index for insight queries by rule
    await collection.createIndex(
      { rule_id: 1, tenant_id: 1, created_at: -1 },
      { 
        name: 'rule_tenant_created',
        background: true 
      }
    )

    // Index for insight status queries
    await collection.createIndex(
      { tenant_id: 1, status: 1, created_at: -1 },
      { 
        name: 'tenant_status_created',
        background: true 
      }
    )
  }

  /**
   * Create indexes for adaptive thresholds collection
   */
  private async createAdaptiveThresholdIndexes(): Promise<void> {
    const collection = this.db.collection('adaptive_thresholds')

    // Primary index for threshold lookups
    await collection.createIndex(
      { tenant_id: 1, signal_type: 1, field: 1 },
      { 
        name: 'tenant_signal_field',
        unique: true,
        background: true 
      }
    )

    // Index for threshold queries by tenant
    await collection.createIndex(
      { tenant_id: 1, computed_at: -1 },
      { 
        name: 'tenant_computed',
        background: true 
      }
    )
  }

  /**
   * Create indexes for novelty tracker collection
   */
  private async createNoveltyTrackerIndexes(): Promise<void> {
    const collection = this.db.collection('novelty_tracker')

    // Index for novelty state lookups
    await collection.createIndex(
      { tenant_id: 1, signal_type: 1, field: 1 },
      { 
        name: 'tenant_signal_field',
        unique: true,
        background: true 
      }
    )
  }

  /**
   * Create indexes for change-point detection collection
   */
  private async createChangePointIndexes(): Promise<void> {
    const collection = this.db.collection('change_point_state')

    // Index for change-point state lookups
    await collection.createIndex(
      { tenant_id: 1, field: 1 },
      { 
        name: 'tenant_field',
        unique: true,
        background: true 
      }
    )
  }

  /**
   * Create indexes for feature hash scorer collection
   */
  private async createFeatureHashIndexes(): Promise<void> {
    const collection = this.db.collection('feature_hash_models')

    // Index for tenant-scoped model lookups
    await collection.createIndex(
      { tenant_id: 1, detector_id: 1 },
      { 
        name: 'tenant_detector',
        unique: true,
        background: true 
      }
    )
  }

  /**
   * Create indexes for calibration collection
   */
  private async createCalibrationIndexes(): Promise<void> {
    const collection = this.db.collection('calibration_params')

    // Index for calibration lookups
    await collection.createIndex(
      { tenant_id: 1, detector_id: 1 },
      { 
        name: 'tenant_detector',
        unique: true,
        background: true 
      }
    )

    // Index for drift detection queries
    await collection.createIndex(
      { tenant_id: 1, fitted_at: -1, drift_detected: 1 },
      { 
        name: 'tenant_fitted_drift',
        background: true 
      }
    )
  }

  /**
   * Get index statistics for monitoring
   */
  async getIndexStats(): Promise<Record<string, any>> {
    const collections = [
      'signals',
      'insights', 
      'adaptive_thresholds',
      'novelty_tracker',
      'change_point_state',
      'feature_hash_models',
      'calibration_params'
    ]

    const stats: Record<string, any> = {}

    for (const collectionName of collections) {
      try {
        const collection = this.db.collection(collectionName)
        const indexes = await collection.indexes()
        stats[collectionName] = {
          indexCount: indexes.length,
          indexes: indexes.map((idx: any) => ({
            name: idx.name,
            keys: idx.key
          }))
        }
      } catch (err) {
        stats[collectionName] = { error: String(err) }
      }
    }

    return stats
  }

  /**
   * Drop all indexes (except default _id index) - use with caution
   */
  async dropAllIndexes(): Promise<void> {
    const collections = [
      'signals',
      'insights', 
      'adaptive_thresholds',
      'novelty_tracker',
      'change_point_state',
      'feature_hash_models',
      'calibration_params'
    ]

    for (const collectionName of collections) {
      try {
        const collection = this.db.collection(collectionName)
        const indexes = await collection.indexes()
        
        for (const idx of indexes) {
          if (idx.name !== '_id_') {
            await collection.dropIndex(idx.name)
          }
        }
      } catch (err) {
        // Ignore errors for non-existent collections
      }
    }
  }
}

// Singleton instance factory
export function createIndexManager(db: MongoDb): DatabaseIndexManager {
  return new DatabaseIndexManager(db)
}