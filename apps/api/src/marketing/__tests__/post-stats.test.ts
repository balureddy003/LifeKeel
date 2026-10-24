import { describe, expect, it } from 'vitest'
import {
  hourBucket,
  lengthBucket,
  postStats,
  uniquePostTag,
  type PostFeatures,
} from '../post-stats.js'

const post = (over: Record<string, unknown>) => ({
  id: 'p',
  post_tag: 'p0000001',
  channel: 'x',
  features: {
    format: 'myth_vs_file',
    hook: 'question',
    pillar: 'chart',
    channel: 'x',
    length_bucket: 'short',
    hour_bucket: 'morning',
    has_media: false,
  } as PostFeatures,
  published_at: new Date('2026-10-20T09:00:00Z'),
  created_at: new Date('2026-10-19T09:00:00Z'),
  ...over,
})

describe('post-stats buckets', () => {
  it('buckets length at the documented cut points', () => {
    expect(lengthBucket('x'.repeat(140))).toBe('short')
    expect(lengthBucket('x'.repeat(141))).toBe('medium')
    expect(lengthBucket('x'.repeat(400))).toBe('medium')
    expect(lengthBucket('x'.repeat(401))).toBe('long')
  })

  it('buckets the scheduled hour in Europe/London, not UTC', () => {
    // 09:00 UTC in late October is 09:00 London (GMT) → morning.
    expect(hourBucket(new Date('2026-10-26T09:00:00Z'))).toBe('morning')
    // In BST (July) 10:30 UTC is 11:30 London → midday, not morning.
    expect(hourBucket(new Date('2026-07-01T10:30:00Z'))).toBe('midday')
    expect(hourBucket(new Date('2026-10-26T13:00:00Z'))).toBe('midday')
    expect(hourBucket(new Date('2026-10-26T17:00:00Z'))).toBe('afternoon')
    expect(hourBucket(new Date('2026-10-26T22:00:00Z'))).toBe('evening')
    expect(hourBucket(null)).toBeNull()
    expect(hourBucket(undefined)).toBeNull()
  })
})

describe('uniquePostTag', () => {
  it('retries when the draw collides with a stored tag', async () => {
    const draws = ['paaaaaaaa', 'pbbbbbbbb']
    const col = {
      findOne: async (f: { post_tag?: string }) =>
        f.post_tag === 'paaaaaaaa' ? { post_tag: 'paaaaaaaa' } : null,
    }
    // Force the draws deterministically: 'a' nibble = 10/16 rand, 'b' = 11/16.
    let i = 0
    const rand = () => (draws[Math.floor(i++ / 8)] === 'paaaaaaaa' ? 10 / 16 : 11 / 16)
    expect(await uniquePostTag(col, rand)).toBe('pbbbbbbbb')
  })
})

describe('postStats', () => {
  it('joins visits and signups by tag, and by slug for pre-tag posts', () => {
    const visits = new Map([
      ['p0000001', 9],
      ['old-slug', 4],
    ])
    const signups = new Map([
      ['p0000001', 2],
      ['old-slug', 1],
    ])
    const view = postStats(
      [post({}), post({ id: 'old', post_tag: undefined, source_blog_slug: 'old-slug' })],
      visits,
      signups,
    )
    const [first, second] = view.rows
    expect(first!.visits).toBe(4) // legacy slug join, untagged
    expect(first!.tagged).toBe(false)
    expect(second!.visits).toBe(9)
    expect(second!.signups).toBe(2)
    expect(second!.tagged).toBe(true)
  })

  it('marks groups under 5 posts insufficient and excludes untagged posts', () => {
    const posts = [
      post({ id: 'a' }),
      post({ id: 'b', post_tag: 'p0000002' }),
      post({ id: 'c', post_tag: undefined, source_blog_slug: 's' }),
    ]
    const view = postStats(posts, new Map(), new Map())
    const formatGroups = view.groups['format']!
    expect(formatGroups).toHaveLength(1) // the untagged post forms no group
    expect(formatGroups[0]!.key).toBe('myth_vs_file')
    expect(formatGroups[0]!.insufficient).toBe(true)
    expect(formatGroups[0]!.visits_per_post_interval).toBeNull()
    expect(formatGroups[0]!.signup_rate_interval).toBeNull()
  })

  it('groups five or more tagged posts with a visits-per-post interval', () => {
    const posts = Array.from({ length: 5 }, (_, i) =>
      post({ id: `p${i}`, post_tag: `p000000${i}` }),
    )
    const visits = new Map(posts.map((p) => [p.post_tag, 10]))
    const view = postStats(posts, visits as Map<string, number>, new Map())
    const g = view.groups['format']!.find((x) => x.key === 'myth_vs_file')!
    expect(g.insufficient).toBe(false)
    expect(g.visits_per_post).toBe(10)
    expect(g.visits_per_post_interval!.low).toBeLessThan(10)
    expect(g.visits_per_post_interval!.high).toBeGreaterThan(10)
    expect(g.signup_rate_interval).not.toBeNull() // wilson(0, 50) is a valid interval
    expect(g.signup_rate_interval!.high).toBeLessThan(0.2)
  })
})
