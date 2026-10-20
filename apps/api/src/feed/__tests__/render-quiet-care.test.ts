/**
 * PRD-138 Quiet Care digest renderer: fixed structure, specifics first, a real
 * "no changes" line, at most one item worth a look, a failure variant that
 * never says all clear, and no promotional or recommending language.
 */
import { describe, expect, it } from 'vitest'
import { renderQuietCareDigest, type QuietCareData } from '../render-quiet-care.js'

const base: QuietCareData = {
  period_label: 'September 2026',
  range_label: '1–30 September',
  check: { status: 'ran', last_check: new Date('2026-10-01T06:30:00Z') },
  score: 62,
  score_delta: 0,
  moved_events: 0,
  new_insights: 0,
  resolved_insights: 0,
  renewals: [],
  worth_a_look: null,
  paused: [],
  next_check: new Date('2026-11-01T08:00:00Z'),
  app_url: 'https://app.example.test',
}

const allCopy = (r: ReturnType<typeof renderQuietCareDigest>) =>
  `${r.subject}\n${r.text}\n${r.html}`

describe('renderQuietCareDigest', () => {
  it('an all-clear month states the real last check and says "No changes"', () => {
    const r = renderQuietCareDigest(base)
    expect(r.subject).toBe("Your family's September 2026: all clear")
    expect(r.text).toContain('The daily check last ran on 1 October.')
    expect(r.text).toContain('covers 1–30 September')
    expect(r.text).toContain('No changes this month.')
    expect(r.text).toContain('Readiness score unchanged at 62.')
    expect(r.text).toContain('Next digest: 1 November.')
    expect(r.text).not.toContain('Worth a look')
    expect(r.text).not.toContain('Paused')
  })

  it('follows the fixed section order', () => {
    const r = renderQuietCareDigest({
      ...base,
      worth_a_look: { text: 'An item', href: 'https://app.example.test/insights/1' },
      paused: ['Older figures.'],
    })
    const order = ['What we checked', 'What changed', 'Worth a look', 'Paused', 'Next digest']
    const at = order.map((h) => r.text.indexOf(h))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })

  it('a month with movement reports the diff, not "No changes"', () => {
    const r = renderQuietCareDigest({
      ...base,
      score_delta: 3,
      score: 65,
      new_insights: 1,
      resolved_insights: 2,
    })
    expect(r.text).toContain('Readiness score up 3 to 65.')
    expect(r.text).toContain('1 new item on file.')
    expect(r.text).toContain('2 items resolved.')
    expect(r.text).not.toContain('No changes this month.')
  })

  it('leads with a real renewal date when one is coming up', () => {
    const r = renderQuietCareDigest({
      ...base,
      renewals: [{ type: 'life', renewal_date: '2026-12-02' }],
    })
    expect(r.text).toContain('Coming up: life renewal on 2 December.')
  })

  it('shows at most one item worth a look, with a link to it', () => {
    const r = renderQuietCareDigest({
      ...base,
      worth_a_look: {
        text: 'Cover looks lower than your income suggests.',
        href: 'https://app.example.test/insights/9',
      },
    })
    expect(r.subject).toBe("Your family's September 2026: 1 thing worth a look")
    expect(r.text.match(/Worth a look/g)).toHaveLength(1)
    expect(r.html).toContain('href="https://app.example.test/insights/9"')
  })

  it('the failure variant never claims all clear and says when it last ran', () => {
    const r = renderQuietCareDigest({
      ...base,
      check: { status: 'missed', last_check: new Date('2026-09-20T06:30:00Z') },
      worth_a_look: { text: 'ignored', href: 'x' },
    })
    expect(r.subject).toBe("We couldn't run this month's checks")
    expect(allCopy(r)).not.toMatch(/all clear/i)
    expect(r.text).toContain('20 September')
    expect(r.text).not.toContain('Worth a look')
  })

  it('failure variant without any known run does not invent a date', () => {
    const r = renderQuietCareDigest({ ...base, check: { status: 'missed', last_check: null } })
    expect(r.text).toContain("We can't confirm a recent check.")
  })

  it('shows the cadence and a manage link, and carries no promotion', () => {
    const r = renderQuietCareDigest(base)
    expect(r.text).toContain('once a month')
    expect(r.text).toContain('https://app.example.test/settings#notifications')
    expect(allCopy(r)).not.toMatch(/\b(upgrade|keel plus|discount|offer|subscribe|free trial)\b/i)
  })

  it('escapes content in the HTML body', () => {
    const r = renderQuietCareDigest({
      ...base,
      worth_a_look: { text: '<script>x</script>', href: 'https://a.test/?a=1&b=2' },
    })
    expect(r.html).not.toContain('<script>')
    expect(r.html).toContain('&amp;b=2')
  })

  it('keeps the greeting placeholder the heartbeat email wrapper personalises', () => {
    expect(renderQuietCareDigest(base).html).toContain('<p>Hi,</p>')
  })
})
