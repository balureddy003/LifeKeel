/**
 * Calibration Job Scheduler
 * 
 * Automatically schedules and runs calibration jobs for detectors.
 * Supports different schedules based on detector evaluation volume.
 */

// MongoDB types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MongoDb = { collection: (name: string) => any }

export interface CalibrationJob {
  detector_id: string
  tenant_id: string
  schedule: 'daily' | 'weekly' | 'monthly'
  last_run_at?: Date
  next_run_at: Date
  status: 'pending' | 'running' | 'completed' | 'failed'
  error?: string
  created_at: Date
}

export interface CalibrationJobConfig {
  /** High-volume detectors (>100 evaluations/day) - daily calibration */
  high_volume_threshold?: number
  /** Medium-volume detectors - weekly calibration */
  medium_volume_threshold?: number
  /** Low-volume detectors - monthly calibration */
  low_volume_threshold?: number
  /** Default schedule if volume is unknown */
  default_schedule?: 'daily' | 'weekly' | 'monthly'
}

export class CalibrationJobScheduler {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private col: any
  private config: CalibrationJobConfig

  constructor(db: MongoDb, config: CalibrationJobConfig = {}) {
    this.col = db.collection('calibration_jobs')
    this.config = {
      high_volume_threshold: 100,
      medium_volume_threshold: 10,
      low_volume_threshold: 0,
      default_schedule: 'weekly',
      ...config,
    }
    this.ensureIndexes()
  }

  private ensureIndexes(): void {
    this.col.createIndex({ detector_id: 1, tenant_id: 1 }, { unique: true }).catch(() => {})
    this.col.createIndex({ next_run_at: 1 }).catch(() => {})
    this.col.createIndex({ status: 1 }).catch(() => {})
  }

  /**
   * Create or update a calibration job for a detector
   */
  async scheduleJob(
    detectorId: string,
    tenantId: string,
    evaluationCount?: number,
  ): Promise<void> {
    const schedule = this.determineSchedule(evaluationCount)
    const nextRunAt = this.calculateNextRun(schedule)

    await this.col.updateOne(
      { detector_id: detectorId, tenant_id: tenantId },
      {
        $set: {
          detector_id: detectorId,
          tenant_id: tenantId,
          schedule,
          next_run_at: nextRunAt,
          status: 'pending',
          updated_at: new Date(),
        },
        $setOnInsert: {
          created_at: new Date(),
        },
      },
      { upsert: true },
    )
  }

  /**
   * Determine schedule based on evaluation volume
   */
  private determineSchedule(evaluationCount?: number): 'daily' | 'weekly' | 'monthly' {
    if (!evaluationCount) return this.config.default_schedule!

    if (evaluationCount >= this.config.high_volume_threshold!) return 'daily'
    if (evaluationCount >= this.config.medium_volume_threshold!) return 'weekly'
    return 'monthly'
  }

  /**
   * Calculate next run time based on schedule
   */
  private calculateNextRun(schedule: 'daily' | 'weekly' | 'monthly'): Date {
    const now = new Date()
    switch (schedule) {
      case 'daily':
        return new Date(now.getTime() + 24 * 60 * 60 * 1000)
      case 'weekly':
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      case 'monthly':
        return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    }
  }

  /**
   * Get jobs that are due to run
   */
  async getDueJobs(): Promise<CalibrationJob[]> {
    const now = new Date()
    return this.col
      .find({
        next_run_at: { $lte: now },
        status: 'pending',
      })
      .toArray()
  }

  /**
   * Mark job as running
   */
  async markRunning(jobId: string): Promise<void> {
    await this.col.updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'running',
          last_run_at: new Date(),
        },
      },
    )
  }

  /**
   * Mark job as completed
   */
  async markCompleted(jobId: string): Promise<void> {
    const job = await this.col.findOne({ _id: jobId })
    if (!job) return

    const nextRunAt = this.calculateNextRun(job.schedule)

    await this.col.updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'completed',
          next_run_at: nextRunAt,
          updated_at: new Date(),
        },
      },
    )
  }

  /**
   * Mark job as failed
   */
  async markFailed(jobId: string, error: string): Promise<void> {
    const job = await this.col.findOne({ _id: jobId })
    if (!job) return

    // Retry in 1 hour on failure
    const nextRunAt = new Date(Date.now() + 60 * 60 * 1000)

    await this.col.updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'failed',
          error,
          next_run_at: nextRunAt,
          updated_at: new Date(),
        },
      },
    )
  }

  /**
   * Get all jobs for a tenant
   */
  async getJobs(tenantId: string): Promise<CalibrationJob[]> {
    return this.col.find({ tenant_id: tenantId }).toArray()
  }

  /**
   * Delete a job
   */
  async deleteJob(detectorId: string, tenantId: string): Promise<void> {
    await this.col.deleteOne({ detector_id: detectorId, tenant_id: tenantId })
  }

  /**
   * Get job statistics
   */
  async getStats(): Promise<{
    total: number
    pending: number
    running: number
    completed: number
    failed: number
  }> {
    const total = await this.col.countDocuments()
    const pending = await this.col.countDocuments({ status: 'pending' })
    const running = await this.col.countDocuments({ status: 'running' })
    const completed = await this.col.countDocuments({ status: 'completed' })
    const failed = await this.col.countDocuments({ status: 'failed' })

    return { total, pending, running, completed, failed }
  }
}
