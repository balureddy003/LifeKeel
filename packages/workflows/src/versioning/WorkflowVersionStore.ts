/**
 * WorkflowVersionStore — persists workflow definition history in MongoDB.
 * Called by WorkflowLoader before overwriting a saved workflow.
 */

import { createHash } from 'crypto'
import type { Collection, Db } from 'mongodb'
import type { WorkflowDef } from '../types.js'

export interface WorkflowVersion {
  workflow_id: string
  version_hash: string          // SHA-256 of the serialised def (first 16 chars)
  def: WorkflowDef
  saved_at: string
  saved_by?: string
  label?: string                // optional human tag e.g. "before prod deploy"
  node_count: number
  diff_summary?: string         // one-line summary of what changed vs previous
}

export class WorkflowVersionStore {
  private col: Collection<WorkflowVersion>

  constructor(db: Db) {
    this.col = db.collection<WorkflowVersion>('workflow_versions')
    void this.col.createIndex({ workflow_id: 1, saved_at: -1 })
    void this.col.createIndex({ workflow_id: 1, version_hash: 1 }, { unique: true })
  }

  /** Compute a short hash for a workflow def */
  static hash(def: WorkflowDef): string {
    return createHash('sha256')
      .update(JSON.stringify(def))
      .digest('hex')
      .slice(0, 16)
  }

  /** Save a version snapshot before overwriting */
  async saveVersion(def: WorkflowDef, savedBy?: string): Promise<WorkflowVersion> {
    const hash = WorkflowVersionStore.hash(def)
    const version: WorkflowVersion = {
      workflow_id: def.id,
      version_hash: hash,
      def,
      saved_at: new Date().toISOString(),
      node_count: def.nodes.length,
      ...(savedBy !== undefined ? { saved_by: savedBy } : {}),
    }

    // Upsert by hash — don't create duplicates for the same content
    await this.col.updateOne(
      { workflow_id: def.id, version_hash: hash },
      { $setOnInsert: version },
      { upsert: true },
    )

    // Keep max 50 versions per workflow
    const all = await this.col
      .find({ workflow_id: def.id })
      .sort({ saved_at: -1 })
      .toArray()

    if (all.length > 50) {
      const toDelete = all.slice(50).map(v => v.version_hash)
      await this.col.deleteMany({ workflow_id: def.id, version_hash: { $in: toDelete } })
    }

    return version
  }

  /** List version history for a workflow (newest first) */
  async listVersions(workflowId: string, limit = 20): Promise<Omit<WorkflowVersion, 'def'>[]> {
    const docs = await this.col
      .find({ workflow_id: workflowId })
      .sort({ saved_at: -1 })
      .limit(limit)
      .project({ def: 0 })   // exclude the full def from the list
      .toArray()
    return docs as unknown as Omit<WorkflowVersion, 'def'>[]
  }

  /** Get a specific version by hash */
  async getVersion(workflowId: string, hash: string): Promise<WorkflowVersion | null> {
    return this.col.findOne({ workflow_id: workflowId, version_hash: hash }) as Promise<WorkflowVersion | null>
  }

  /** Diff two workflow defs — returns human-readable change summary */
  static diff(oldDef: WorkflowDef, newDef: WorkflowDef): DiffResult {
    const changes: string[] = []

    if (oldDef.name !== newDef.name)
      changes.push(`name: "${oldDef.name}" → "${newDef.name}"`)

    if (oldDef.enabled !== newDef.enabled)
      changes.push(`enabled: ${oldDef.enabled} → ${newDef.enabled}`)

    const oldIds = new Set(oldDef.nodes.map(n => n.id))
    const newIds = new Set(newDef.nodes.map(n => n.id))

    const added   = newDef.nodes.filter(n => !oldIds.has(n.id))
    const removed = oldDef.nodes.filter(n => !newIds.has(n.id))
    const changed = newDef.nodes.filter(n => {
      if (!oldIds.has(n.id)) return false
      const old = oldDef.nodes.find(o => o.id === n.id)
      return JSON.stringify(old) !== JSON.stringify(n)
    })

    for (const n of added)   changes.push(`+ node added: ${n.id} (${n.type})`)
    for (const n of removed) changes.push(`- node removed: ${n.id}`)
    for (const n of changed) changes.push(`~ node changed: ${n.id}`)

    const edgesChanged = JSON.stringify(oldDef.edges) !== JSON.stringify(newDef.edges)
    if (edgesChanged) changes.push('~ edges changed')

    return {
      summary: changes.length === 0 ? 'No changes' : changes.slice(0, 3).join(', ') + (changes.length > 3 ? ` + ${changes.length - 3} more` : ''),
      changes,
      added_nodes:   added.map(n => ({ id: n.id, type: n.type, label: n.label })),
      removed_nodes: removed.map(n => ({ id: n.id, type: n.type, label: n.label })),
      changed_nodes: changed.map(n => ({ id: n.id, type: n.type, label: n.label })),
      edges_changed: edgesChanged,
    }
  }
}

export interface DiffResult {
  summary: string
  changes: string[]
  added_nodes:   Array<{ id: string; type: string; label: string }>
  removed_nodes: Array<{ id: string; type: string; label: string }>
  changed_nodes: Array<{ id: string; type: string; label: string }>
  edges_changed: boolean
}
