/**
 * PRD-202: the detector-content seed migration writes one valid,
 * published blog post per chosen detector rule, and every rule_id it
 * references still exists in the real detector YAML — the enforceable
 * version of the PRD's own "content-to-detector coverage ratio" metric.
 */

import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine } from '@lifekeel/engine'
import { migrations } from '../migrate.js'
import { DETECTOR_CONTENT_POSTS } from '../detector-content-posts.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DETECTORS_DIR = path.resolve(__dirname, '../../../../detectors')

const VALID_CATEGORIES = new Set(['product', 'tutorial', 'case-study', 'news'])

function makeFakeDb() {
  const upserts: Record<string, unknown>[] = []
  const col = {
    updateOne: async (filter: { slug: string }, update: { $set: Record<string, unknown>; $setOnInsert?: Record<string, unknown> }) => {
      upserts.push({ ...update.$setOnInsert, ...update.$set, slug: filter.slug })
      return { acknowledged: true }
    },
  }
  return { db: { collection: () => col } as any, upserts }
}

describe('PRD-202: detector-content seed migration', () => {
  it('writes exactly 6 valid, published posts with unique slugs', async () => {
    const migration = migrations.find((m) => m.id === '20260913000000-seed-detector-content-posts')
    expect(migration).toBeDefined()

    const { db, upserts } = makeFakeDb()
    await migration!.up(db)

    expect(upserts).toHaveLength(6)
    const slugs = upserts.map((p) => p['slug'])
    expect(new Set(slugs).size).toBe(6)

    for (const post of upserts) {
      expect(typeof post['title']).toBe('string')
      expect((post['title'] as string).length).toBeGreaterThan(0)
      expect(typeof post['content']).toBe('string')
      expect((post['content'] as string).length).toBeGreaterThan(0)
      expect(typeof post['excerpt']).toBe('string')
      expect((post['excerpt'] as string).length).toBeGreaterThan(0)
      expect(typeof post['author']).toBe('string')
      expect((post['author'] as string).length).toBeGreaterThan(0)
      expect(VALID_CATEGORIES.has(post['category'] as string)).toBe(true)
      expect(post['published']).toBe(true)
      // rule_id is a content-authoring field, not part of the persisted
      // blog_posts shape (BlogPostSchema has no such field) — must be
      // stripped before insert.
      expect(post['rule_id']).toBeUndefined()
    }
  })

  it('every rule_id referenced by the seeded content still exists in the real detector YAML', async () => {
    const engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()

    const allRuleIds = new Set<string>()
    for (const detector of engine.inventory()) {
      for (const rule of detector.rules) {
        allRuleIds.add(rule.id)
      }
    }

    for (const post of DETECTOR_CONTENT_POSTS) {
      expect(allRuleIds.has(post.rule_id)).toBe(true)
    }
  })
})
