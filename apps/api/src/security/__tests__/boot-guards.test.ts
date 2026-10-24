import { describe, expect, it } from 'vitest'
import { apiDocsEnabled, evaluateBootGuards } from '../boot-guards.js'

const SCRAPE = 's'.repeat(32)

describe('boot guards (§8.4)', () => {
  it('dev mode never blocks boot', () => {
    expect(
      evaluateBootGuards({ ALLOW_DEMO_TOKENS: '1', ENABLE_API_DOCS: 'true' }, 'dev').violations,
    ).toEqual([])
  })

  it('cloud mode requires a scrape token', () => {
    expect(evaluateBootGuards({}, 'cloud').violations.join()).toContain('METRICS_SCRAPE_TOKEN')
    expect(evaluateBootGuards({ METRICS_SCRAPE_TOKEN: 'short' }, 'cloud').violations).toHaveLength(
      1,
    )
    expect(evaluateBootGuards({ METRICS_SCRAPE_TOKEN: SCRAPE }, 'cloud').violations).toEqual([])
  })

  it('refuses ALLOW_DEMO_TOKENS in any non-dev mode', () => {
    for (const mode of ['cloud', 'airgap', 'accountant']) {
      const r = evaluateBootGuards({ METRICS_SCRAPE_TOKEN: SCRAPE, ALLOW_DEMO_TOKENS: '1' }, mode)
      expect(r.violations.join()).toContain('ALLOW_DEMO_TOKENS')
    }
  })

  it('API docs outside dev need a recorded exception, which is logged', () => {
    const bare = evaluateBootGuards(
      { METRICS_SCRAPE_TOKEN: SCRAPE, ENABLE_API_DOCS: 'true' },
      'cloud',
    )
    expect(bare.violations.join()).toContain('API_DOCS_EXCEPTION')
    const ok = evaluateBootGuards(
      { METRICS_SCRAPE_TOKEN: SCRAPE, ENABLE_API_DOCS: 'true', API_DOCS_EXCEPTION: 'SEC-12' },
      'cloud',
    )
    expect(ok.violations).toEqual([])
    expect(ok.exceptions.join()).toContain('SEC-12')
  })

  it('docs are on in dev, off in cloud unless excepted', () => {
    expect(apiDocsEnabled({}, 'dev')).toBe(true)
    expect(apiDocsEnabled({ ENABLE_API_DOCS: 'true' }, 'cloud')).toBe(false)
    expect(apiDocsEnabled({ ENABLE_API_DOCS: 'true', API_DOCS_EXCEPTION: 'x' }, 'cloud')).toBe(true)
  })
})
