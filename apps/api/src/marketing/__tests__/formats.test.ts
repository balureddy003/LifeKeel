import { describe, expect, it } from 'vitest'
import { loadFormats, chooseFormat, chooseHook, renderFormatFallback } from '../formats.js'
import { BRIEFS } from '../content-plan.js'
import { checkCopy } from '../copy-guard.js'

const defs = loadFormats()

describe('marketing-formats.yaml', () => {
  it('loads with three active formats and the held ones reserved', () => {
    const active = defs.formats.filter((f) => f.status === 'active')
    const held = defs.formats.filter((f) => f.status === 'held')
    expect(active.map((f) => f.id).sort()).toEqual([
      'hard_day_steps',
      'myth_vs_file',
      'one_thing_to_check',
    ])
    expect(held.map((f) => f.id).sort()).toEqual(['calendar_moment', 'illustrative_scene'])
  })

  it('no hook or format text contains fear, urgency, scarcity or guarantee wording', () => {
    const bad =
      /\b(fear|scare|urgent|urgency|scarce|scarcity|guarantee[ds]?|act now|don't miss|limited time|hurry|risk-free|before it's too late)\b/i
    for (const h of defs.hooks) expect(h.id + h.label).not.toMatch(bad)
    for (const f of defs.formats)
      expect(f.draft_prompt + f.fallback + f.label, f.id).not.toMatch(bad)
  })

  it('every active-format fallback passes the copy guard with every brief', () => {
    for (const f of defs.formats.filter((f) => f.status === 'active'))
      for (const b of BRIEFS) {
        const out = renderFormatFallback(f, b.facts)
        expect(checkCopy(out, 'social'), `${f.id}/${b.id}`).toEqual({ ok: true, violations: [] })
      }
  })
})

describe('chooseFormat / chooseHook', () => {
  it('picks the least-used suitable format and a different one per slot', () => {
    const taken = new Set<string>()
    const picks = ['bluesky', 'x', 'linkedin'].map((ch) => {
      const f = chooseFormat(defs.formats, ch, new Map(), taken)!
      taken.add(f.id)
      return f.id
    })
    expect(new Set(picks).size).toBe(3) // a different format per slot
  })

  it('never returns held or thread formats, and repeats least-used once all are taken', () => {
    const taken = new Set(['myth_vs_file', 'one_thing_to_check', 'hard_day_steps'])
    const f = chooseFormat(defs.formats, 'x', new Map([['hard_day_steps', 5]]), taken)
    expect(f!.status).toBe('active')
    expect(f!.id).not.toBe('calendar_moment')
    expect(f!.id).not.toBe('illustrative_scene')
    // Least-used repeats when everything is taken.
    expect(['myth_vs_file', 'one_thing_to_check']).toContain(f!.id)
  })

  it('returns null on a channel with no suitable format', () => {
    expect(chooseFormat(defs.formats, 'tiktok', new Map(), new Set())).toBeNull()
  })

  it('chooseHook rotates least-used and avoids taken hooks', () => {
    const taken = new Set<string>()
    const first = chooseHook(defs.hooks, new Map(), taken)
    taken.add(first.id)
    const second = chooseHook(defs.hooks, new Map([[first.id, 3]]), taken)
    expect(second.id).not.toBe(first.id)
  })
})
