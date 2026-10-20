/**
 * Quiet Care digest renderer (PRD-138) — the monthly proof-of-work email,
 * sent even when nothing changed. Pure function over gathered facts.
 *
 * Fixed order, readable in about 20 seconds: headline, what we checked, what
 * changed (a diff that may be empty), at most one thing worth a look, what is
 * paused, the next check. It leads with specifics (a real last-check date, a
 * real renewal) rather than a count of checks, and it never claims all clear
 * when the sweep did not run: that month gets the failure variant instead.
 *
 * Strictly informational: no upsell, no promotion (PECR), and the one thing
 * worth a look reuses detector copy that already passes the advice rule.
 */
import type { RenderedHeartbeat } from './render-heartbeat.js'

export interface QuietCareData {
  /** e.g. "September 2026" — the month reported on. */
  period_label: string
  /** e.g. "1–30 September". */
  range_label: string
  /** 'ran' only when a run record shows the daily sweep completed recently. */
  check: { status: 'ran'; last_check: Date } | { status: 'missed'; last_check: Date | null }
  score: number | null
  score_delta: number | null
  moved_events: number
  new_insights: number
  resolved_insights: number
  renewals: { type: string; renewal_date: string }[]
  /** The single highest-confidence open item, or null. */
  worth_a_look: { text: string; href: string } | null
  /** Plain-language notes for checks running on older figures. */
  paused: string[]
  next_check: Date
  app_url: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** "14 October" in UTC, so a date never shifts with the server's zone. */
export function formatDay(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function changedLines(d: QuietCareData): string[] {
  const lines: string[] = []
  if (d.score !== null) {
    if (d.score_delta === null) lines.push(`Readiness score: ${d.score}.`)
    else if (d.score_delta === 0) lines.push(`Readiness score unchanged at ${d.score}.`)
    else
      lines.push(
        `Readiness score ${d.score_delta > 0 ? 'up' : 'down'} ${Math.abs(d.score_delta)} to ${d.score}.`,
      )
  }
  if (d.new_insights > 0) lines.push(`${plural(d.new_insights, 'new item', 'new items')} on file.`)
  if (d.resolved_insights > 0)
    lines.push(`${plural(d.resolved_insights, 'item', 'items')} resolved.`)
  if (d.moved_events > 0)
    lines.push(`${plural(d.moved_events, 'update', 'updates')} in your family's feed.`)
  const nothingMoved =
    d.new_insights === 0 &&
    d.resolved_insights === 0 &&
    d.moved_events === 0 &&
    (d.score_delta === null || d.score_delta === 0)
  if (nothingMoved) lines.unshift('No changes this month.')
  return lines
}

export function renderQuietCareDigest(d: QuietCareData): RenderedHeartbeat {
  const settingsUrl = `${d.app_url}/settings#notifications`
  const next = `Next digest: ${formatDay(d.next_check)}.`
  const cadence = 'You get this once a month. You can change how often, or turn it off.'

  let subject: string
  let headline: string
  let sections: { title: string; lines: string[] }[]

  if (d.check.status === 'missed') {
    subject = "We couldn't run this month's checks"
    headline = "We couldn't run this month's checks."
    const last = d.check.last_check
      ? `The last check we can confirm ran on ${formatDay(d.check.last_check)}.`
      : "We can't confirm a recent check."
    sections = [
      {
        title: 'What happened',
        lines: [
          "Our daily check didn't complete, so we can't tell you everything is fine.",
          last,
          "We've been alerted and are looking into it.",
        ],
      },
      { title: 'What is on file', lines: ['Everything you saved is still there.'] },
    ]
  } else {
    const note = d.worth_a_look
    const allClear = note === null
    subject = allClear
      ? `Your family's ${d.period_label}: all clear`
      : `Your family's ${d.period_label}: 1 thing worth a look`
    headline = allClear
      ? `All clear for ${d.period_label}.`
      : `${d.period_label}: one thing worth a look.`
    const checked = [
      `The daily check last ran on ${formatDay(d.check.last_check)}.`,
      `This digest covers ${d.range_label}.`,
    ]
    if (d.renewals.length > 0) {
      checked.push(
        `Coming up: ${d.renewals
          .map(
            (r) => `${r.type.replace(/_/g, ' ')} renewal on ${formatDay(new Date(r.renewal_date))}`,
          )
          .join(', ')}.`,
      )
    }
    sections = [
      { title: 'What we checked', lines: checked },
      { title: 'What changed', lines: changedLines(d) },
    ]
    if (note) sections.push({ title: 'Worth a look', lines: [note.text] })
    if (d.paused.length > 0) sections.push({ title: 'Paused', lines: d.paused })
  }

  const textBody = [
    headline,
    ...sections.map((s) => `${s.title}\n${s.lines.map((l) => `· ${l}`).join('\n')}`),
    next,
    cadence,
    d.worth_a_look && d.check.status === 'ran' ? `Details: ${d.worth_a_look.href}` : '',
    `Open LifeKeel: ${d.app_url}`,
    `Why you got this · Manage notifications → ${settingsUrl}`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const html = `
    <p>Hi,</p>
    <h2 style="font-size:18px;margin:0 0 12px;">${escapeHtml(headline)}</h2>
    ${sections
      .map(
        (s) =>
          `<h3 style="font-size:14px;margin:16px 0 4px;">${escapeHtml(s.title)}</h3><ul style="padding-left:18px;margin:0;">${s.lines
            .map((l) => `<li style="margin:4px 0;">${escapeHtml(l)}</li>`)
            .join('')}</ul>`,
      )
      .join('')}
    ${
      d.worth_a_look && d.check.status === 'ran'
        ? `<p><a href="${escapeHtml(d.worth_a_look.href)}">See the details</a></p>`
        : ''
    }
    <p style="margin-top:16px;">${escapeHtml(next)}</p>
    <p><a href="${escapeHtml(d.app_url)}" style="display:inline-block;padding:12px 20px;background:#7c6ef0;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;">Open LifeKeel</a></p>
    <p style="color:#888;font-size:13px;">${escapeHtml(cadence)} <a href="${escapeHtml(settingsUrl)}" style="color:#888;">Why you got this · Manage notifications</a></p>
  `

  return {
    subject,
    text: textBody,
    html,
    push_title: subject,
    push_body: headline,
  }
}
