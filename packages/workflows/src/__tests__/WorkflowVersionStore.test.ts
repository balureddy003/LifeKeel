/**
 * WorkflowVersionStore unit tests
 *
 * Tests: SHA-256 hashing, deduplication, diff detection, version listing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WorkflowVersionStore } from '../versioning/WorkflowVersionStore.js'
import type { WorkflowDef } from '../types.js'
import type { Db } from 'mongodb'

// ── Minimal WorkflowDef fixture ───────────────────────────────────────────────

function makeWf(overrides: Partial<WorkflowDef> = {}): WorkflowDef {
  return {
    id: 'test-wf',
    name: 'Test Workflow',
    version: '1.0.0',
    enabled: true,
    trigger: { event_type: 'test.event' },
    state: {},
    nodes: [{ id: 'n1', type: 'ai_generate', label: 'Generate', config: {} }],
    edges: [],
    ...overrides,
  } as WorkflowDef
}

// ── MongoDB collection stub ───────────────────────────────────────────────────

function makeCollection() {
  const docs: Record<string, unknown>[] = []
  return {
    createIndex: vi.fn(async () => 'index_name'),
    updateOne: vi.fn(async (filter: Record<string, unknown>, update: { $setOnInsert?: Record<string, unknown> }, opts?: { upsert?: boolean }) => {
      const hash = filter['version_hash']
      const existing = docs.find(d => d['version_hash'] === hash)
      if (!existing && opts?.upsert) {
        docs.push({ ...filter, ...(update['$setOnInsert'] ?? {}) })
      }
    }),
    find: vi.fn(() => ({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: async () => docs.filter(d => d['workflow_id'] === 'test-wf')
        .map(({ def: _def, ...rest }) => rest),
    })),
    findOne: vi.fn(async (filter: Record<string, unknown>) =>
      docs.find(d => d['version_hash'] === filter['version_hash']) ?? null
    ),
    _docs: docs,
  }
}

function makeDb(col: ReturnType<typeof makeCollection>): Db {
  return { collection: () => col } as unknown as Db
}

// ─────────────────────────────────────────────────────────────────────────────

describe('WorkflowVersionStore', () => {
  let col: ReturnType<typeof makeCollection>
  let store: WorkflowVersionStore

  beforeEach(() => {
    col = makeCollection()
    store = new WorkflowVersionStore(makeDb(col))
  })

  it('hash() returns a stable 16-char hex string', () => {
    const wf = makeWf()
    const h1 = WorkflowVersionStore.hash(wf)
    const h2 = WorkflowVersionStore.hash(wf)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{16}$/)
  })

  it('hash() differs when workflow content changes', () => {
    const wf1 = makeWf({ name: 'Version 1' })
    const wf2 = makeWf({ name: 'Version 2' })
    expect(WorkflowVersionStore.hash(wf1)).not.toBe(WorkflowVersionStore.hash(wf2))
  })

  it('saveVersion() upserts with setOnInsert — no duplicate for same content', async () => {
    const wf = makeWf()
    await store.saveVersion(wf, 'user-1')
    await store.saveVersion(wf, 'user-1') // same content again

    expect(col.updateOne).toHaveBeenCalledTimes(2)
    // Only one doc in store due to upsert key
    expect(col._docs.length).toBe(1)
  })

  it('saveVersion() creates new entry for changed content', async () => {
    await store.saveVersion(makeWf({ name: 'V1' }), 'user-1')
    await store.saveVersion(makeWf({ name: 'V2' }), 'user-1')
    expect(col._docs.length).toBe(2)
  })

  describe('diff()', () => {
    it('detects added nodes', () => {
      const old = makeWf()
      const updated = makeWf({
        nodes: [...old.nodes, { id: 'n2', type: 'notify', label: 'Notify', config: {} }],
      })
      const result = WorkflowVersionStore.diff(old, updated)
      expect(result.added_nodes.map(n => n.id)).toContain('n2')
      expect(result.removed_nodes).toHaveLength(0)
      expect(result.changed_nodes).toHaveLength(0)
    })

    it('detects removed nodes', () => {
      const old = makeWf({
        nodes: [
          { id: 'n1', type: 'ai_generate', label: 'Gen', config: {} },
          { id: 'n2', type: 'notify', label: 'Notify', config: {} },
        ],
      })
      const updated = makeWf({ nodes: [{ id: 'n1', type: 'ai_generate', label: 'Gen', config: {} }] })
      const result = WorkflowVersionStore.diff(old, updated)
      expect(result.removed_nodes.map(n => n.id)).toContain('n2')
      expect(result.added_nodes).toHaveLength(0)
    })

    it('detects changed nodes (config modification)', () => {
      const old = makeWf({ nodes: [{ id: 'n1', type: 'ai_generate', label: 'Gen', config: { model: 'claude-haiku' } }] })
      const updated = makeWf({ nodes: [{ id: 'n1', type: 'ai_generate', label: 'Gen', config: { model: 'claude-sonnet' } }] })
      const result = WorkflowVersionStore.diff(old, updated)
      expect(result.changed_nodes.map(n => n.id)).toContain('n1')
    })

    it('returns empty diff for identical workflows', () => {
      const wf = makeWf()
      const result = WorkflowVersionStore.diff(wf, wf)
      expect(result.added_nodes).toHaveLength(0)
      expect(result.removed_nodes).toHaveLength(0)
      expect(result.changed_nodes).toHaveLength(0)
    })
  })
})
