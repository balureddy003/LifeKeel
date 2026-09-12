import type { Db, Collection } from 'mongodb'

export type EmbedFn = (text: string) => Promise<number[]>

export class EmbeddingWorker {
  private readonly col: Collection
  private running = false

  constructor(private readonly db: Db, private readonly embedFn: EmbedFn, private readonly batchSize = 50) {
    this.col = db.collection('agent_memory')
  }

  /** Process a single batch of un-embedded records. */
  async processOnce(): Promise<number> {
    const docs = await this.col.find({ embedding: { $exists: false } }).sort({ created_at: 1 }).limit(this.batchSize).toArray()
    let updated = 0
    for (const doc of docs) {
      const text = (typeof doc.content === 'string' ? doc.content : (doc.summary ?? JSON.stringify(doc.content ?? '')))
      try {
        const embedding = await this.embedFn(String(text))
        await this.col.updateOne({ tenant_id: doc.tenant_id, id: doc.id }, { $set: { embedding } })
        updated++
      } catch {
        // ignore failures for now; worker can retry later
      }
    }
    return updated
  }

  /** Start continuous processing loop with given interval (ms). */
  start(intervalMs = 1000): void {
    if (this.running) return
    this.running = true
    const loop = async () => {
      while (this.running) {
        try { await this.processOnce() } catch { /* swallow */ }
        // eslint-disable-next-line no-await-in-loop
        await new Promise(r => setTimeout(r, intervalMs))
      }
    }
    void loop()
  }

  stop(): void {
    this.running = false
  }
}

export default EmbeddingWorker
