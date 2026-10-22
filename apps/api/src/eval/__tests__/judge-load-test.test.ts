import { describe, expect, it } from 'vitest'
import {
  classifyPrompt,
  contextProbe,
  formatReport,
  mayRun,
  parseLevels,
  percentile,
  summarise,
  type Sample,
} from '../judge-load-test.js'

const ok = (ms: number): Sample => ({ ok: true, ms, status: 200 })
const bad = (ms: number): Sample => ({ ok: false, ms, status: 503, error: 'HTTP 503' })

describe('percentile', () => {
  it('uses nearest rank and tolerates unsorted and empty input', () => {
    expect(percentile([], 95)).toBe(0)
    expect(percentile([5], 50)).toBe(5)
    expect(percentile([10, 1, 5, 3, 7], 50)).toBe(5)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9)
  })
})

describe('summarise', () => {
  it('computes latency from successful calls only and counts errors', () => {
    const s = summarise(2, [ok(1000), ok(3000), bad(60000)], 4000)
    expect(s.requests).toBe(3)
    expect(s.errors).toBe(1)
    expect(s.errorRate).toBeCloseTo(1 / 3)
    expect(s.maxMs).toBe(3000)
    expect(s.p50Ms).toBe(1000)
    // 2 successes over 4s of wall time.
    expect(s.throughputPerMin).toBeCloseTo(30)
  })

  it('does not divide by zero when nothing ran or everything failed', () => {
    expect(summarise(1, [], 0)).toMatchObject({ requests: 0, errorRate: 0, throughputPerMin: 0 })
    expect(summarise(1, [bad(10)], 100)).toMatchObject({ errors: 1, p95Ms: 0, throughputPerMin: 0 })
  })
})

describe('parseLevels', () => {
  it('parses, filters junk, and falls back to 1,2,4', () => {
    expect(parseLevels('1, 3,8')).toEqual([1, 3, 8])
    expect(parseLevels(undefined)).toEqual([1, 2, 4])
    expect(parseLevels('x,0,-2,99')).toEqual([1, 2, 4])
  })
})

describe('mayRun — the spending guard', () => {
  it('allows localhost without confirmation', () => {
    expect(mayRun('http://localhost:11434', undefined).ok).toBe(true)
    expect(mayRun('http://127.0.0.1:11434', undefined).ok).toBe(true)
  })

  it('refuses a deployed service unless LOAD_TEST_CONFIRM=yes', () => {
    const url = 'https://lifekeel-local-judge-abc-uc.a.run.app'
    expect(mayRun(url, undefined).ok).toBe(false)
    expect(mayRun(url, 'true').ok).toBe(false)
    expect(mayRun(url, undefined).why).toMatch(/LOAD_TEST_CONFIRM=yes/)
    expect(mayRun(url, 'yes').ok).toBe(true)
  })

  it('rejects an invalid URL', () => {
    expect(mayRun('not a url', 'yes').ok).toBe(false)
  })
})

describe('prompts', () => {
  it('cycles through the labelled emails with the production tag framing', () => {
    expect(classifyPrompt(0).prompt).toContain('<email_subject>')
    expect(classifyPrompt(0).prompt).not.toBe(classifyPrompt(1).prompt)
  })

  it('the context probe is longer than the old 4096-token default and holds the code only at the start', () => {
    const p = contextProbe('ABC-123')
    // ~4,600 tokens at roughly 4 characters per token.
    expect(p.prompt.length).toBeGreaterThan(4096 * 4)
    expect(p.prompt.startsWith('The access code is ABC-123')).toBe(true)
    expect(p.prompt.split('ABC-123')).toHaveLength(2)
  })
})

describe('formatReport', () => {
  const level = (c: number, perMin: number) => summarise(c, [ok(1000)], (1 / perMin) * 60_000)

  it('flags flat throughput as expected for concurrency 1', () => {
    const text = formatReport('m', [level(1, 4), level(2, 4.2), level(4, 3.9)], null)
    expect(text).toMatch(/only adds latency/)
  })

  it('flags parallel serving when throughput rises', () => {
    const text = formatReport('m', [level(1, 4), level(4, 12)], null)
    expect(text).toMatch(/serving calls in parallel/)
  })

  it('reports a context failure with the cause', () => {
    const text = formatReport('m', [level(1, 4)], { ok: false, answer: '123456', ms: 5000 })
    expect(text).toMatch(/Context check: FAIL/)
    expect(text).toMatch(/num_ctx is not taking effect/)
    expect(formatReport('m', [level(1, 4)], { ok: true, answer: 'x', ms: 5000 })).toMatch(
      /Context check: PASS/,
    )
  })
})
