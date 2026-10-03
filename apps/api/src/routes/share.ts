/**
 * GET /share/readiness — the per-score share card.
 *
 * The web app is a static export: it can't emit per-result Open Graph
 * tags, but a shared score link is only as good as the preview card a
 * scraper (WhatsApp, iMessage, LinkedIn, X) renders from its meta tags.
 * This route solves it from the API: the score travels IN the URL (the
 * quiz's privacy contract — nothing about a visitor is persisted — is
 * preserved; the user is broadcasting their own number voluntarily).
 *
 * Scrapers get HTML with per-score og:title/description; humans get a
 * meta-refresh straight through to the real quiz with share-attribution
 * UTM params, so /operator/funnel can measure the loop:
 * share → click → quiz → signup.
 */
import type { FastifyInstance } from 'fastify'

function esc(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

export async function registerShareRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { s?: string } }>(
    '/share/readiness',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const raw = Number(req.query.s)
      const hasScore = Number.isFinite(raw) && raw >= 0 && raw <= 100
      const score = hasScore ? Math.round(raw) : null

      const appUrl = (process.env['AGENT_OAK_URL'] ?? 'https://kairos-trellis.web.app').replace(/\/$/, '')
      const target = `${appUrl}/readiness/?utm_source=share&utm_medium=social&utm_campaign=score_share`

      const title = score !== null
        ? `Family Readiness ${score}/100 — how does yours compare?`
        : 'Check your family\u2019s readiness — free, about a minute'
      const description = score !== null
        ? `Someone scored ${score}/100 on Agent Oak\u2019s Family Readiness Check — the signals families usually find out too late. Anonymous, free, no signup.`
        : 'Agent Oak checks the signals families usually find out too late — coverage gaps, savings drift, renewal deadlines. Free and anonymous.'

      reply.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Agent Oak">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${appUrl}/readiness/">
<meta property="og:image" content="${appUrl}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${appUrl}/og-image.png">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
</head>
<body>
<p><a href="${esc(target)}">Check your family\u2019s readiness →</a></p>
</body>
</html>`)
    },
  )
}
