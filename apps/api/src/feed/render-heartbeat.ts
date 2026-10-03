/**
 * Family heartbeat renderer (PRD-136 §4) — the weekly/monthly "what
 * moved" email. Pure function over gathered counts; the email explains
 * movement, evidence-light: open items, renewals coming, steps still
 * open, and whether the profile is going stale. Informational only —
 * it never recommends a product or action beyond "open the app".
 */

export interface HeartbeatData {
  /** 'week' | 'month' — matched to the tenant's heartbeat_cadence. */
  period: 'week' | 'month'
  window_start: Date
  /** Composite score change across the window, or null without ≥2 snapshots. */
  score_delta: number | null
  /** Non-muted readiness feed events in the window. */
  moved_events: number
  open_insights: number
  new_insights: number
  resolved_insights: number
  /** Policies renewing within 30 days of the send. */
  renewals: { type: string; renewal_date: string }[]
  pending_steps: number
  /** Profile untouched >180 days. */
  profile_stale: boolean
  /** Annual review due (same rule as /family/financial-profile/review). */
  review_due: boolean
  app_url: string
}

export interface RenderedHeartbeat {
  subject: string
  text: string
  html: string
  push_title: string
  push_body: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function plural(n: number, word: string, words?: string): string {
  return `${n} ${n === 1 ? word : (words ?? `${word}s`)}`
}

export function renderHeartbeat(d: HeartbeatData): RenderedHeartbeat {
  // "Things to look at" = open gaps + response-plan steps still open.
  const todo = d.open_insights + d.pending_steps
  const nothingMoved = d.moved_events === 0 && d.new_insights === 0 && d.resolved_insights === 0

  const subjectParts: string[] = []
  if (d.score_delta !== null && d.score_delta !== 0) {
    subjectParts.push(`score ${d.score_delta > 0 ? '+' : ''}${d.score_delta}`)
  }
  if (todo > 0) subjectParts.push(plural(todo, 'thing', 'things') + ' to look at')
  const subject =
    subjectParts.length === 0
      ? `Your family's ${d.period}: nothing moved`
      : `Your family's ${d.period}: ${subjectParts.join(', ')}`

  const lines: string[] = []
  if (d.score_delta !== null && d.score_delta !== 0) {
    lines.push(`· Your readiness score moved ${d.score_delta > 0 ? '+' : ''}${d.score_delta}.`)
  }
  if (d.new_insights > 0 || d.open_insights > 0) {
    lines.push(`· ${plural(d.open_insights, 'open item', 'open items')} on your family's readiness${d.new_insights > 0 ? ` (${d.new_insights} new this ${d.period})` : ''}${d.resolved_insights > 0 ? `, ${d.resolved_insights} resolved` : ''}.`)
  }
  if (d.renewals.length > 0) {
    lines.push(`· ${plural(d.renewals.length, 'policy', 'policies')} renewing within 30 days: ${d.renewals.map((r) => `${r.type.replace(/_/g, ' ')} on ${r.renewal_date}`).join(', ')}.`)
  }
  if (d.pending_steps > 0) {
    lines.push(`· ${plural(d.pending_steps, 'step', 'steps')} still open on your response plan.`)
  }
  if (d.review_due) {
    lines.push(`· Your annual profile review is due — a quick confirm keeps the score honest.`)
  } else if (d.profile_stale) {
    lines.push(`· Some profile details are over six months old — worth a quick check.`)
  }
  if (lines.length === 0) {
    lines.push(`Nothing moved this ${d.period} — Oak checked daily and everything looked the same.`)
  }
  lines.push(`Open Agent Oak: ${d.app_url}`)

  const footer = 'Why you got this · Manage notifications'
  const footerUrl = `${d.app_url}/settings#notifications`
  const text = `${lines.join('\n')}\n\n${footer} → ${footerUrl}`

  const items = lines
    .slice(0, -1)
    .map((l) => `<li style="margin:6px 0;">${escapeHtml(l.replace(/^· /, ''))}</li>`)
    .join('')
  const html = `
    <p>Hi,</p>
    <p>Here's what moved in your family's readiness this ${d.period}:</p>
    <ul style="padding-left:18px;">${items}</ul>
    <p><a href="${d.app_url}" style="display:inline-block;padding:12px 20px;background:#7c6ef0;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;">Open Agent Oak</a></p>
    <p style="color:#888;font-size:13px;"><a href="${footerUrl}" style="color:#888;">Why you got this · Manage notifications</a></p>
  `

  return {
    subject,
    text,
    html,
    push_title: subject,
    push_body: lines[0] ?? subject,
  }
}
