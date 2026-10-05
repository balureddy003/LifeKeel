import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DecisionFn } from '@lifekeel/platform'

const processDocumentMock = vi.fn(async (..._args: unknown[]) => {})
vi.mock('../extract.js', () => ({ processDocument: (...a: unknown[]) => processDocumentMock(...a) }))

let downloadShouldFail = false
vi.mock('mongodb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mongodb')>()
  return {
    ...actual,
    GridFSBucket: vi.fn().mockImplementation(function FakeBucket() {
      return {
        openDownloadStream: () => (async function* () {
          if (downloadShouldFail) throw new Error('blob missing')
          yield Buffer.from('file-bytes')
        })(),
      }
    }),
  }
})

const { retryFailedDocuments, MAX_DOCUMENT_ATTEMPTS } = await import('../retry-failed.js')

function makeDb(docs: Array<Record<string, unknown>>) {
  const updates: Array<{ filter: unknown; update: Record<string, unknown> }> = []
  let capturedQuery: Record<string, unknown> = {}
  const col = {
    find: vi.fn((q: Record<string, unknown>) => {
      capturedQuery = q
      return { sort: () => ({ limit: () => ({ toArray: async () => docs }) }) }
    }),
    updateOne: vi.fn(async (filter: unknown, update: Record<string, unknown>) => { updates.push({ filter, update }) }),
  }
  return { db: { collection: () => col } as any, updates, query: () => capturedQuery }
}

const decide = (() => {}) as unknown as DecisionFn
const doc = (over: Record<string, unknown> = {}) => ({ _id: 'oid1', id: 'doc-1', tenant_id: 't1', file_id: 'f1', mime_type: 'image/png', filename: 'a.png', ...over })

describe('retryFailedDocuments', () => {
  beforeEach(() => { processDocumentMock.mockClear(); downloadShouldFail = false })

  it('only selects errored documents under the attempt limit that failed long enough ago', async () => {
    const now = new Date('2026-10-02T12:00:00Z')
    const { db, query } = makeDb([])
    await retryFailedDocuments(db, decide, now)
    const q = query() as any
    expect(q.status).toBe('error')
    expect(q.retry_count).toEqual({ $lt: MAX_DOCUMENT_ATTEMPTS })
    expect(q.processing_completed_at.$lte.getTime()).toBe(now.getTime() - 5 * 60_000)
  })

  it('re-runs extraction with the stored bytes and the local model, scoped to the document tenant', async () => {
    const { db } = makeDb([doc()])
    const attempted = await retryFailedDocuments(db, decide)
    expect(attempted).toBe(1)
    expect(processDocumentMock).toHaveBeenCalledWith(db, 'doc-1', 't1', Buffer.from('file-bytes'), 'image/png', 'a.png', decide)
  })

  it('counts an attempt when the stored file cannot be read, so a missing blob is not retried forever', async () => {
    downloadShouldFail = true
    const { db, updates } = makeDb([doc()])
    const attempted = await retryFailedDocuments(db, decide)
    expect(attempted).toBe(0)
    expect(processDocumentMock).not.toHaveBeenCalled()
    expect(updates[0]!.update['$inc']).toEqual({ retry_count: 1 })
  })

  it('skips a document with no tenant instead of processing it unscoped', async () => {
    const { db } = makeDb([doc({ tenant_id: undefined })])
    expect(await retryFailedDocuments(db, decide)).toBe(0)
    expect(processDocumentMock).not.toHaveBeenCalled()
  })
})
