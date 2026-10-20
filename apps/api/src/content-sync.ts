/**
 * Seeded blog content stays in step with its source (PRD-210, phase 0).
 *
 * detector-content-posts.ts is the source of the detector-driven posts. The original migration
 * inserted them once, so a correction in the source never reached posts already live. This sync
 * runs at startup, after migrations, and is idempotent:
 *
 *   - Each post stores `source_hash`, a hash of its source fields.
 *   - Source unchanged (hash equal): nothing to do.
 *   - Source changed and the live post is unedited: update it and the hash.
 *   - Source changed and the live post was edited in the console: leave it and mark
 *     `source_diverged: true` so the operator can see it needs a decision.
 *
 * "Unedited" means the live content still hashes to the stored source_hash. Legacy rows from the
 * original migration have no hash; they count as unedited only when updated_at equals created_at.
 */
import { createHash } from 'node:crypto'
import type { Db } from 'mongodb'
import { DETECTOR_CONTENT_POSTS } from './detector-content-posts.js'

type SeedPost = Omit<(typeof DETECTOR_CONTENT_POSTS)[number], 'rule_id'>

export function sourceHash(p: Pick<SeedPost, 'title' | 'excerpt' | 'content' | 'category' | 'tags' | 'author'>): string {
  return createHash('sha256')
    .update(JSON.stringify([p.title, p.excerpt, p.content, p.category, p.tags, p.author]))
    .digest('hex')
}

export interface ContentSyncResult {
  inserted: number
  updated: number
  diverged: number
  unchanged: number
}

export async function syncSeededContent(db: Db, now = new Date()): Promise<ContentSyncResult> {
  const col = db.collection('blog_posts')
  const result: ContentSyncResult = { inserted: 0, updated: 0, diverged: 0, unchanged: 0 }
  for (const { rule_id: _ruleId, ...post } of DETECTOR_CONTENT_POSTS) {
    const hash = sourceHash(post)
    const live = await col.findOne({ slug: post.slug })
    if (!live) {
      await col.insertOne({
        ...post,
        id: post.slug,
        published: true,
        source_hash: hash,
        created_at: now,
        updated_at: now,
        published_at: now,
      })
      result.inserted++
      continue
    }
    if (live['source_hash'] === hash) {
      result.unchanged++
      continue
    }
    const unedited =
      live['source_hash'] !== undefined
        ? sourceHash({
            title: String(live['title']),
            excerpt: String(live['excerpt']),
            content: String(live['content']),
            category: live['category'] as SeedPost['category'],
            tags: (live['tags'] as string[]) ?? [],
            author: String(live['author']),
          }) === live['source_hash']
        : live['updated_at'] instanceof Date &&
          live['created_at'] instanceof Date &&
          live['updated_at'].getTime() === live['created_at'].getTime()
    if (unedited) {
      await col.updateOne(
        { slug: post.slug },
        { $set: { ...post, source_hash: hash, updated_at: now }, $unset: { source_diverged: '' } },
      )
      result.updated++
    } else {
      await col.updateOne({ slug: post.slug }, { $set: { source_diverged: true } })
      result.diverged++
    }
  }
  return result
}
