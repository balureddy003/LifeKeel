/**
 * The one HTML shell every outgoing email uses, styled to match the website
 * (apps/web/src/components/landing/landing.css, light theme).
 *
 * Email-client constraints shape this file: table layout and inline styles
 * only, no SVG (Gmail drops it), and no web-font loading — the site's faces
 * are named first in each stack so readers who have them get them, and no
 * font server is contacted when an email is opened.
 *
 * `title`, `eyebrow`, `preheader`, link labels and footer text are escaped
 * here. `bodyHtml` is trusted markup: callers must pass user-supplied values
 * (names, family names, titles) through `escapeHtml` themselves.
 */

export const EMAIL_COLORS = {
  page: '#eef3f4',
  card: '#ffffff',
  ink: '#0e2433',
  muted: '#42596a',
  line: '#cfdce0',
  cta: '#d9a441',
  onCta: '#14202a',
  brassText: '#7a5206',
  skyA: '#cfe3ea',
  skyB: '#f7ecd9',
  wave: '#2b7f97',
  wave2: '#1d6a82',
  wave3: '#14566b',
  success: '#17664a',
  warning: '#9a5b06',
  danger: '#9c3a22',
  info: '#1d6a82',
} as const

export const EMAIL_FONTS = {
  display: "'Instrument Serif', Georgia, 'Times New Roman', serif",
  body: "'Hanken Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  wordmark: "Fraunces, Georgia, 'Times New Roman', serif",
  mono: "'IBM Plex Mono', Menlo, Consolas, monospace",
} as const

export interface EmailLink {
  url: string
  label: string
}

export type EmailTone = 'success' | 'warning' | 'danger' | 'info'

export interface EmailFooter {
  /** One sentence: why this person got this email. */
  reason: string
  unsubscribeUrl?: string
  manageUrl?: string
}

export interface EmailContent {
  /** Inbox preview text shown next to the subject. */
  preheader: string
  title?: string
  eyebrow?: string
  badge?: { label: string; tone: EmailTone }
  bodyHtml: string
  cta?: EmailLink
  secondaryLinks?: EmailLink[]
  /** Small muted line under the button, as plain text. */
  note?: string
  footer: EmailFooter
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function appUrl(): string {
  return (process.env['LIFEKEEL_URL'] ?? 'http://localhost:3002').replace(/\/$/, '')
}

export function p(html: string): string {
  return `<p style="margin:0 0 16px;">${html}</p>`
}

export function muted(html: string): string {
  return `<p style="margin:0 0 16px;color:${EMAIL_COLORS.muted};font-size:14px;line-height:1.5;">${html}</p>`
}

function linkUrl(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Email links must use HTTP(S) without embedded credentials')
  }
  return escapeHtml(value)
}

/** Brass call to action, built as a table cell so Outlook renders it as a button. */
export function button(link: EmailLink): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px;">
  <tr><td bgcolor="${EMAIL_COLORS.cta}" style="border-radius:12px;background:${EMAIL_COLORS.cta};">
    <a href="${linkUrl(link.url)}" style="display:inline-block;padding:14px 26px;font-family:${EMAIL_FONTS.body};font-size:16px;font-weight:600;line-height:1;color:${EMAIL_COLORS.onCta};text-decoration:none;border-radius:12px;">${escapeHtml(link.label)}</a>
  </td></tr>
</table>`
}

function textLink(link: EmailLink, color: string = EMAIL_COLORS.brassText): string {
  return `<a href="${linkUrl(link.url)}" style="color:${color};text-decoration:underline;">${escapeHtml(link.label)}</a>`
}

function logoRow(base: string, size: number, wordmarkSize: number): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="padding-right:10px;vertical-align:middle;"><img src="${linkUrl(`${base}/icon-192.png`)}" width="${size}" height="${size}" alt="" style="display:block;border:0;border-radius:${Math.round(size * 0.22)}px;"></td>
    <td style="vertical-align:middle;font-family:${EMAIL_FONTS.wordmark};font-size:${wordmarkSize}px;font-weight:600;letter-spacing:-0.2px;color:${EMAIL_COLORS.ink};">LifeKeel</td>
  </tr></table>`
}

function hero(c: EmailContent, base: string): string {
  const badge = c.badge
    ? `<div style="margin:0 0 12px;"><span style="display:inline-block;padding:4px 10px;border:1px solid ${EMAIL_COLORS[c.badge.tone]};border-radius:999px;font-family:${EMAIL_FONTS.mono};font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:${EMAIL_COLORS[c.badge.tone]};">${escapeHtml(c.badge.label)}</span></div>`
    : ''
  const eyebrow = c.eyebrow
    ? `<div style="margin:0 0 10px;font-family:${EMAIL_FONTS.mono};font-size:11px;letter-spacing:1.6px;text-transform:uppercase;color:${EMAIL_COLORS.muted};">${escapeHtml(c.eyebrow)}</div>`
    : ''
  const title = c.title
    ? `<h1 style="margin:0;font-family:${EMAIL_FONTS.display};font-size:34px;line-height:1.12;font-weight:400;color:${EMAIL_COLORS.ink};">${escapeHtml(c.title)}</h1>`
    : ''
  const headline =
    badge || eyebrow || title
      ? `<tr><td style="padding:28px 32px 32px;">${badge}${eyebrow}${title}</td></tr>`
      : '<tr><td style="padding:0 0 16px;font-size:0;line-height:0;">&nbsp;</td></tr>'
  const stripe = (color: string) =>
    `<tr><td height="4" bgcolor="${color}" style="height:4px;font-size:0;line-height:0;background:${color};">&nbsp;</td></tr>`

  return `<tr><td bgcolor="${EMAIL_COLORS.skyA}" style="background:${EMAIL_COLORS.skyA};background-image:linear-gradient(135deg,${EMAIL_COLORS.skyA} 0%,${EMAIL_COLORS.skyB} 100%);border-radius:20px 20px 0 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td style="padding:24px 32px 0;"><a href="${linkUrl(base)}" style="text-decoration:none;">${logoRow(base, 36, 22)}</a></td></tr>
    ${headline}
  </table>
</td></tr>
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${stripe(EMAIL_COLORS.wave)}${stripe(EMAIL_COLORS.wave2)}${stripe(EMAIL_COLORS.wave3)}</table></td></tr>`
}

function footer(f: EmailFooter, base: string): string {
  const address = process.env['EMAIL_POSTAL_ADDRESS']?.trim() || 'Milton Keynes, MK4 4NW, UK'
  const color = EMAIL_COLORS.muted
  const links: EmailLink[] = [
    { url: base, label: 'Open LifeKeel' },
    { url: `${base}/support`, label: 'Support' },
    { url: `${base}/privacy`, label: 'Privacy' },
    { url: `${base}/terms`, label: 'Terms' },
  ]
  if (f.manageUrl) links.push({ url: f.manageUrl, label: 'Manage notifications' })
  if (f.unsubscribeUrl) links.push({ url: f.unsubscribeUrl, label: 'Unsubscribe' })

  return `<tr><td style="padding:28px 32px 8px;" align="center">
  ${logoRow(base, 24, 16)}
  <p style="margin:10px 0 14px;font-family:${EMAIL_FONTS.display};font-size:17px;color:${EMAIL_COLORS.ink};">Your family&#39;s chart, kept current.</p>
  <p style="margin:0 0 14px;font-family:${EMAIL_FONTS.body};font-size:13px;line-height:1.8;color:${color};">${links.map((l) => textLink(l, color)).join(' &nbsp;·&nbsp; ')}</p>
  <p style="margin:0 0 6px;font-family:${EMAIL_FONTS.body};font-size:12px;line-height:1.5;color:${color};">${escapeHtml(f.reason)}</p>
  <p style="margin:0 0 6px;font-family:${EMAIL_FONTS.body};font-size:12px;line-height:1.5;color:${color};">LifeKeel · ${escapeHtml(address)}</p>
  <p style="margin:0 0 24px;font-family:${EMAIL_FONTS.body};font-size:12px;line-height:1.5;color:${color};">Information only, not regulated advice.</p>
</td></tr>`
}

export function renderEmail(c: EmailContent): string {
  const base = appUrl()
  const cta = c.cta ? button(c.cta) : ''
  const secondary = c.secondaryLinks?.length
    ? `<p style="margin:0 0 8px;font-size:14px;line-height:1.8;">${c.secondaryLinks.map((l) => textLink(l)).join(' &nbsp;·&nbsp; ')}</p>`
    : ''
  const note = c.note ? muted(escapeHtml(c.note)) : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(c.title ?? 'LifeKeel')}</title>
</head>
<body style="margin:0;padding:0;background:${EMAIL_COLORS.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${EMAIL_COLORS.page}" style="background:${EMAIL_COLORS.page};">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
    ${hero(c, base)}
    <tr><td bgcolor="${EMAIL_COLORS.card}" style="background:${EMAIL_COLORS.card};border:1px solid ${EMAIL_COLORS.line};border-top:0;border-radius:0 0 20px 20px;padding:32px 32px 24px;font-family:${EMAIL_FONTS.body};font-size:16px;line-height:1.6;color:${EMAIL_COLORS.ink};">
      ${c.bodyHtml}
      ${cta}
      ${secondary}
      ${note}
    </td></tr>
    ${footer(c.footer, base)}
  </table>
</td></tr>
</table>
</body>
</html>`
}
