import { describe, it, expect } from 'vitest'
import { syncSeededContent, sourceHash } from '../content-sync.js'
import { DETECTOR_CONTENT_POSTS } from '../detector-content-posts.js'

type Doc = Record<string, unknown>

function fakeDb(rows: Doc[] = []) {
  const col = {
    findOne: async (f: { slug: string }) => rows.find((r) => r['slug'] === f.slug) ?? null,
    insertOne: async (d: Doc) => { rows.push(d) },
    updateOne: async (f: { slug: string }, u: { $set?: Doc; $unset?: Doc }) => {
      const r = rows.find((x) => x['slug'] === f.slug)!
      Object.assign(r, u.$set ?? {})
      for (const k of Object.keys(u.$unset ?? {})) delete r[k]
    },
  }
  return { db: { collection: () => col } as never, rows }
}

const first = (() => { const { rule_id: _r, ...p } = DETECTOR_CONTENT_POSTS[0]!; return p })()
const t0 = new Date('2026-09-13')

describe('syncSeededContent', () => {
  it('inserts every post on an empty collection, with a source hash', async () => {
    const { db, rows } = fakeDb()
    const r = await syncSeededContent(db)
    expect(r.inserted).toBe(DETECTOR_CONTENT_POSTS.length)
    expect(rows.every((x) => typeof x['source_hash'] === 'string' && x['published'] === true)).toBe(true)
  })

  it('is a no-op when the source has not changed', async () => {
    const { db } = fakeDb()
    await syncSeededContent(db)
    const r = await syncSeededContent(db)
    expect(r).toEqual({ inserted: 0, updated: 0, diverged: 0, unchanged: DETECTOR_CONTENT_POSTS.length })
  })

  it('updates a legacy seeded row (no hash, never edited) to the corrected source', async () => {
    const { db, rows } = fakeDb([{ ...first, content: 'old wording', created_at: t0, updated_at: t0 }])
    const r = await syncSeededContent(db)
    expect(r.updated).toBe(1)
    expect(rows[0]!['content']).toBe(first.content)
    expect(rows[0]!['source_hash']).toBe(sourceHash(first))
  })

  it('leaves a legacy row alone when it was edited after seeding, and flags it', async () => {
    const { db, rows } = fakeDb([{ ...first, content: 'operator edit', created_at: t0, updated_at: new Date('2026-10-01') }])
    const r = await syncSeededContent(db)
    expect(r.diverged).toBe(1)
    expect(rows[0]!['content']).toBe('operator edit')
    expect(rows[0]!['source_diverged']).toBe(true)
  })

  it('updates a hashed row whose live content still matches its old source, and flags an edited one', async () => {
    const old = { ...first, content: 'previous source' }
    const unedited = { ...old, source_hash: sourceHash(old), created_at: t0, updated_at: t0 }
    const a = fakeDb([unedited])
    expect((await syncSeededContent(a.db)).updated).toBe(1)
    expect(a.rows[0]!['content']).toBe(first.content)

    const edited = { ...old, content: 'operator edit', source_hash: sourceHash(old), created_at: t0, updated_at: t0 }
    const b = fakeDb([edited])
    expect((await syncSeededContent(b.db)).diverged).toBe(1)
    expect(b.rows[0]!['content']).toBe('operator edit')
  })
})
