/** PRD-219: the public card route serves PNGs only for a valid signature. */
import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { registerMarketingCardRoutes } from '../marketing-card.js'
import { signCard } from '../../marketing/cards.js'

const POST = {
  id: 'post-1',
  channel: 'instagram',
  card: { layout: 'headline', headline: 'The cover gap', sub: 'On file' } as const,
}

const db = {
  collection: () => ({
    findOne: async (f: Record<string, unknown>) => (f['id'] === 'post-1' ? POST : null),
  }),
} as any

async function buildApp() {
  const app = Fastify()
  await registerMarketingCardRoutes(app, db)
  await app.ready()
  return app
}

describe('GET /public/social-card/:postId.png', () => {
  it('serves the PNG for a valid signature', async () => {
    const app = await buildApp()
    const s = signCard('post-1', POST.card)
    const res = await app.inject({ method: 'GET', url: `/public/social-card/post-1.png?s=${s}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('image/png')
    expect(res.headers['cache-control']).toContain('immutable')
  })

  it('404s on a bad, missing, or mismatched signature — never reveals the draft', async () => {
    const app = await buildApp()
    for (const url of [
      '/public/social-card/post-1.png?s=deadbeef',
      '/public/social-card/post-1.png',
      '/public/social-card/nope.png?s=deadbeef',
    ]) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode).toBe(404)
      expect(res.body).not.toContain('cover gap')
    }
  })
})
