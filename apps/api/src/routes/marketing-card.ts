/**
 * GET /public/social-card/:postId.png — PRD-219 signed brand cards.
 *
 * Public by design (platforms fetch the image unauthenticated) but sealed:
 * the `s` param is the per-purpose HMAC over post id + card spec, so a URL
 * cannot be guessed or carry an edited card. Rendered on demand from the
 * spec stored on the post — nothing is persisted, no family data is ever
 * on a card (specs are marketing text only). On the open-routes list with a
 * rate-limit note.
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import type { MarketingPostDoc } from './marketing-posts.js'
import { renderCardPng, verifyCard, type CardSpec, type CardChannel } from '../marketing/cards.js'

export async function registerMarketingCardRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.get<{ Params: { postId: string }; Querystring: { s?: string } }>(
    '/public/social-card/:postId.png',
    async (req, reply) => {
      const post = await db
        .collection<MarketingPostDoc>('marketing_posts')
        .findOne({ id: req.params.postId })
      const card = post?.card as CardSpec | undefined
      const channel = post?.channel as CardChannel | undefined
      const given = req.query.s ?? ''
      if (
        !post ||
        !card ||
        !channel ||
        !(channel in { instagram: 1, facebook: 1 }) ||
        !verifyCard(req.params.postId, card, given)
      )
        return reply.status(404).send({ error: 'Not found' })

      const png = await renderCardPng(card, channel)
      return reply
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .type('image/png')
        .send(png)
    },
  )
}
