/**
 * PRD-219: deterministic brand cards for image-required channels.
 *
 * SVG template → PNG via sharp (already a dependency). Text is wrapped
 * and clamped in our code — a card that cannot fit its text is a test
 * failure, never a clipped image. Signing reuses the per-purpose HMAC in
 * auth/signing-key.ts over postId + card spec hash, so a URL cannot be
 * guessed or have its card edited.
 *
 * Deploy note: SVG text renders through libvips' font stack — the runtime
 * image needs a sans-serif font available or glyphs won't draw.
 */
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { hmacFor, verifyLinkHmac } from '../auth/signing-key.js'

export type CardLayout = 'headline' | 'myth_fact'

export interface CardSpec {
  layout: CardLayout
  headline: string
  sub?: string
}

export const CARD_SIZES = {
  instagram: { w: 1080, h: 1350 },
  facebook: { w: 1200, h: 630 },
} as const

export type CardChannel = keyof typeof CARD_SIZES

const BG = '#0e1526' // product dark — keep in step with the presence kit
const FG = '#f5f1e8'
const ACCENT = '#7f9cf5'

/** Greedy word wrap on an estimated average char width; the card fails (test,
 *  not clip) when the text cannot fit in maxLines. */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (next.length > maxChars && cur) {
      lines.push(cur)
      cur = w
    } else cur = next
  }
  if (cur) lines.push(cur)
  if (lines.length > maxLines) throw new Error(`card text overflows ${maxLines} lines`)
  return lines
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function cardSvg(spec: CardSpec, channel: CardChannel): string {
  const { w, h } = CARD_SIZES[channel]
  const headSize = spec.layout === 'myth_fact' ? Math.round(w / 14) : Math.round(w / 12)
  const headLines = wrapText(spec.headline, Math.floor(w / (headSize * 0.52)), 4)
  const subLines = spec.sub ? wrapText(spec.sub, Math.floor(w / (headSize * 0.34)), 3) : []
  const mythLabel = spec.layout === 'myth_fact' ? 'A common assumption' : ''
  const subLabel = spec.layout === 'myth_fact' ? 'What a family can check on file' : ''
  const lineH = headSize * 1.25
  const subSize = Math.round(headSize * 0.55)
  const totalH =
    headLines.length * lineH + subLines.length * subSize * 1.4 + (subLines.length ? 40 : 0)
  let y = Math.round((h - totalH) / 2) + headSize
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<rect width="${w}" height="${h}" fill="${BG}"/>`,
    `<rect x="0" y="${h - 12}" width="${w}" height="12" fill="${ACCENT}"/>`,
  ]
  if (mythLabel)
    parts.push(
      `<text x="${w / 2}" y="${y - headSize * 0.8}" font-family="sans-serif" font-size="${Math.round(headSize * 0.4)}" fill="${ACCENT}" text-anchor="middle" letter-spacing="4">${esc(mythLabel.toUpperCase())}</text>`,
    )
  for (const l of headLines) {
    parts.push(
      `<text x="${w / 2}" y="${y}" font-family="sans-serif" font-weight="bold" font-size="${headSize}" fill="${FG}" text-anchor="middle">${esc(l)}</text>`,
    )
    y += lineH
  }
  if (subLabel)
    parts.push(
      `<text x="${w / 2}" y="${y + 20}" font-family="sans-serif" font-size="${Math.round(headSize * 0.4)}" fill="${ACCENT}" text-anchor="middle" letter-spacing="4">${esc(subLabel.toUpperCase())}</text>`,
    )
  y += subLines.length ? 60 : 0
  for (const l of subLines) {
    parts.push(
      `<text x="${w / 2}" y="${y}" font-family="sans-serif" font-size="${subSize}" fill="${FG}" opacity="0.85" text-anchor="middle">${esc(l)}</text>`,
    )
    y += subSize * 1.4
  }
  parts.push('</svg>')
  return parts.join('')
}

export async function renderCardPng(spec: CardSpec, channel: CardChannel): Promise<Buffer> {
  return sharp(Buffer.from(cardSvg(spec, channel)))
    .png()
    .toBuffer()
}

export function cardSpecHash(spec: CardSpec): string {
  return createHash('sha256')
    .update(JSON.stringify([spec.layout, spec.headline, spec.sub ?? '']))
    .digest('hex')
    .slice(0, 16)
}

/** The signed path segment — covers post id AND spec, so neither can be
 *  edited without invalidating the URL. */
export function signCard(postId: string, spec: CardSpec): string {
  return hmacFor('social-card', `${postId}:${cardSpecHash(spec)}`)
}

export function verifyCard(postId: string, spec: CardSpec, given: string): boolean {
  return verifyLinkHmac('social-card', `${postId}:${cardSpecHash(spec)}`, given)
}

/** The address Meta can fetch the card from: API_PUBLIC_URL when set, else the
 *  deployed API_BASE_URL. A local or plain-http base is never used, because
 *  Instagram downloads the image from the internet and would fail on it. */
function publicApiBase(): string {
  const explicit = (process.env['API_PUBLIC_URL'] ?? '').replace(/\/$/, '')
  if (explicit) return explicit
  const base = (process.env['API_BASE_URL'] ?? '').replace(/\/$/, '')
  try {
    const u = new URL(base)
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    return u.protocol === 'https:' && !local ? base : ''
  } catch {
    return ''
  }
}

/** Absolute card URL for a post doc, or '' when no public API base exists —
 *  the draft then keeps "needs image" rather than a dead link. */
export function cardUrl(postId: string, spec: CardSpec): string {
  const base = publicApiBase()
  return base ? `${base}/public/social-card/${postId}.png?s=${signCard(postId, spec)}` : ''
}
