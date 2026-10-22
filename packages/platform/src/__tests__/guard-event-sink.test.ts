import { describe, it, expect } from 'vitest'
import type { Db } from 'mongodb'
import { createGuardEventSink } from '../guard-event-sink.js'
import type { LlmGuardEvent } from '../llm-guards.js'

const event = (over: Partial<LlmGuardEvent> = {}): LlmGuardEvent => ({
  tenant_id: 't1',
  call_id: 'call-1',
  type: 'forbidden_output',
  field_path: 'output',
  original_hash: 'x',
  action: 'flagged',
  timestamp: new Date(),
  ...over,
})

function fakeDb() {
  const inserted: Record<string, unknown>[] = []
  const db = {
    collection: () => ({
      insertMany: async (docs: Record<string, unknown>[]) => {
        inserted.push(...docs)
        return { insertedCount: docs.length }
      },
    }),
  } as unknown as Db
  return { db, inserted }
}

describe('createGuardEventSink', () => {
  it('persists events with call_site and persisted_at', async () => {
    const { db, inserted } = fakeDb()
    await createGuardEventSink(db, 'task-gateway')([event()])
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ call_site: 'task-gateway', call_id: 'call-1' })
    expect(inserted[0]!['persisted_at']).toBeInstanceOf(Date)
  })

  it('records task_id when the governed caller supplies it — PRD-215 join key', async () => {
    const { db, inserted } = fakeDb()
    await createGuardEventSink(db, 'task-gateway')([event()], { task_id: 'assistant.answer.v1' })
    expect(inserted[0]!['task_id']).toBe('assistant.answer.v1')
  })

  it('omits task_id for callers without task context', async () => {
    const { db, inserted } = fakeDb()
    await createGuardEventSink(db, 'move-judge')([event()])
    expect(inserted[0]).not.toHaveProperty('task_id')
  })

  it('writes nothing for an empty batch', async () => {
    const { db, inserted } = fakeDb()
    await createGuardEventSink(db, 'task-gateway')([])
    expect(inserted).toHaveLength(0)
  })
})
