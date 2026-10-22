import { describe, expect, it } from 'vitest'
import {
  classifyPrompt,
  contextProbe,
  judgeContext,
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

  it('groups failures by cause so a 429 is not confused with a timeout', () => {
    const s = summarise(
      4,
      [ok(1000), bad(5), { ok: false, ms: 300000, status: 504, error: 'HTTP 504' }, bad(7)],
      10_000,
    )
    expect(s.errorsByKind).toEqual({ 'HTTP 503': 2, 'HTTP 504': 1 })
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

  it('sends the real classifier system prompt, identical for every call so its prefix can be cached', () => {
    expect(classifyPrompt(0, 'a').system).toBe(classifyPrompt(3, 'b').system)
    expect(classifyPrompt(0).system).toContain('email triage assistant')
  })

  it('a salt makes each call differ at the start of the user message, after the shared system prompt', () => {
    const a = classifyPrompt(0, 'run1-1-0')
    const b = classifyPrompt(0, 'run1-1-1')
    expect(a.system).toBe(b.system)
    expect(a.prompt).not.toBe(b.prompt)
    expect(a.prompt.startsWith('Ref run1-1-0\n<email_from>')).toBe(true)
    // Same email either way: only the leading salt differs.
    expect(classifyPrompt(0, 'x').prompt.split('\n').slice(1).join('\n')).toBe(
      classifyPrompt(0, 'y').prompt.split('\n').slice(1).join('\n'),
    )
    // No salt keeps the plain production shape.
    expect(classifyPrompt(0).prompt.startsWith('<email_from>')).toBe(true)
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

  it('reports a wrong answer as truncation', () => {
    const text = formatReport('m', [level(1, 4)], {
      outcome: 'wrong_answer',
      answer: '123456',
      ms: 5000,
    })
    expect(text).toMatch(/Context check: FAIL/)
    expect(text).toMatch(/num_ctx is not taking effect/)
  })

  it('reports a failed request as inconclusive, not as truncation', () => {
    const text = formatReport('m', [level(1, 4)], {
      outcome: 'request_failed',
      answer: '',
      ms: 299_998,
      error: 'HTTP 504',
    })
    expect(text).toMatch(/INCONCLUSIVE/)
    expect(text).toMatch(/HTTP 504/)
    expect(text).not.toMatch(/num_ctx is not taking effect/)
  })

  it('reports a pass', () => {
    expect(formatReport('m', [level(1, 4)], { outcome: 'pass', answer: 'x', ms: 5000 })).toMatch(
      /Context check: PASS/,
    )
  })

  it('lists errors by cause under the table', () => {
    const l = summarise(4, [ok(1000), { ok: false, ms: 1, status: 429, error: 'HTTP 429' }], 5000)
    expect(formatReport('m', [l], null)).toMatch(/concurrency 4 errors: 1x HTTP 429/)
  })
})

describe('judgeContext', () => {
  it('separates a correct answer, a wrong answer and a failed request', () => {
    expect(judgeContext(ok(10), 'PELICAN-7731', 'PELICAN-7731').outcome).toBe('pass')
    expect(judgeContext(ok(10), '123456', 'PELICAN-7731').outcome).toBe('wrong_answer')
    const failed = judgeContext(
      { ok: false, ms: 300000, status: 504, error: 'HTTP 504' },
      '',
      'PELICAN-7731',
    )
    expect(failed.outcome).toBe('request_failed')
    expect(failed.error).toBe('HTTP 504')
  })
})
