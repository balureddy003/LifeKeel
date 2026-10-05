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
import sharp from 'sharp'

function esc(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function parseScore(raw: unknown): number | null {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : null
}

/**
 * 1200×630 SVG card → PNG. The ring and digits are pure SVG geometry +
 * text — librsvg (bundled in sharp) rasterizes it. Text needs a real font:
 * the prod image installs ttf-dejavu (see apps/api/Dockerfile); without
 * fontconfig the digits would rasterize blank.
 */
function scoreCardSvg(score: number | null): string {
  const cx = 250, cy = 315, r = 130
  const circ = 2 * Math.PI * r
  const arc = score !== null ? (score / 100) * circ : 0
  const center = score !== null
    ? `<text x="${cx}" y="${cy + 34}" text-anchor="middle" font-size="120" font-weight="700" fill="#f4f4f8">${score}</text>
       <text x="${cx}" y="${cy + 88}" text-anchor="middle" font-size="36" fill="#9b9baa">/100</text>`
    : `<text x="${cx}" y="${cy + 40}" text-anchor="middle" font-size="120" font-weight="700" fill="#8b80f8">?</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" font-family="DejaVu Sans, Verdana, sans-serif">
  <defs>
    <radialGradient id="glow" cx="20%" cy="50%" r="70%">
      <stop offset="0%" stop-color="#8b80f8" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#08080c" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#08080c"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#26262e" stroke-width="22"/>
  ${score !== null ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#8b80f8" stroke-width="22" stroke-linecap="round" stroke-dasharray="${arc.toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>` : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#8b80f8" stroke-width="22" stroke-linecap="round" stroke-dasharray="4 26" transform="rotate(-90 ${cx} ${cy})"/>`}
  ${center}
  <text x="480" y="252" font-size="56" font-weight="700" fill="#f4f4f8">Family Readiness</text>
  <text x="480" y="322" font-size="56" font-weight="700" fill="#8b80f8">Check</text>
  <text x="480" y="398" font-size="30" fill="#9b9baa">${score !== null ? `Someone scored ${score}/100 — how does` : 'The signals families usually'}</text>
  <text x="480" y="440" font-size="30" fill="#9b9baa">${score !== null ? 'yours compare?' : 'find out too late.'}</text>
  <text x="480" y="520" font-size="26" fill="#6b6b78">Free &#183; anonymous &#183; about a minute</text>
  <text x="1080" y="586" text-anchor="end" font-size="28" font-weight="700" fill="#8b80f8">LifeKeel</text>
</svg>`
}

export async function registerShareRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { s?: string } }>(
    '/share/readiness',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const score = parseScore(req.query.s)

      const appUrl = (process.env['LIFEKEEL_URL'] ?? 'http://localhost:3002').replace(/\/$/, '')
      const apiUrl = (process.env['API_BASE_URL'] ?? 'http://localhost:3001').replace(/\/$/, '')
      const target = `${appUrl}/readiness/?utm_source=share&utm_medium=social&utm_campaign=score_share`
      // Per-score rendered PNG served by this API — og:image must be an
      // absolute URL, and the score rides in the query so each shared card
      // caches independently.
      const image = `${apiUrl}/share/readiness/og.png${score !== null ? `?s=${score}` : ''}`

      const title = score !== null
        ? `Family Readiness ${score}/100 — how does yours compare?`
        : 'Check your family\u2019s readiness — free, about a minute'
      const description = score !== null
        ? `Someone scored ${score}/100 on LifeKeel\u2019s Family Readiness Check — the signals families usually find out too late. Anonymous, free, no signup.`
        : 'LifeKeel checks the signals families usually find out too late — coverage gaps, savings drift, renewal deadlines. Free and anonymous.'

      reply.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:site_name" content="LifeKeel">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${appUrl}/readiness/">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
</head>
<body>
<p><a href="${esc(target)}">Check your family\u2019s readiness →</a></p>
</body>
</html>`)
    },
  )

  // Per-score preview image — fetched by scrapers when rendering the share
  // card above. Immutable per URL: a given s= always renders the same card.
  app.get<{ Querystring: { s?: string } }>(
    '/share/readiness/og.png',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const png = await sharp(Buffer.from(scoreCardSvg(parseScore(req.query.s)))).png().toBuffer()
      reply
        .type('image/png')
        .header('cache-control', 'public, max-age=86400, immutable')
        .send(png)
    },
  )
}
