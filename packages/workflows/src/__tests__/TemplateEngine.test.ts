/**
 * TemplateEngine unit tests
 */

import { describe, it, expect } from 'vitest'
import { resolveTemplate, resolveTemplateObject, parseDuration } from '../engine/TemplateEngine.js'
import type { TemplateContext } from '../engine/TemplateEngine.js'

function ctx(state: Record<string, unknown> = {}, event: Record<string, unknown> = {}): TemplateContext {
  return { state, event, tenant: {} }
}

describe('resolveTemplate', () => {
  it('replaces {{state.key}} with state value', () => {
    expect(resolveTemplate('Hello {{state.name}}!', ctx({ name: 'Alice' }))).toBe('Hello Alice!')
  })

  it('replaces multiple state variables', () => {
    expect(resolveTemplate('{{state.a}} + {{state.b}}', ctx({ a: 1, b: 2 }))).toBe('1 + 2')
  })

  it('resolves from event context', () => {
    expect(resolveTemplate('Amount: {{event.amount}}', ctx({}, { amount: 500 }))).toBe('Amount: 500')
  })

  it('keeps original {{}} when key missing', () => {
    const result = resolveTemplate('Hello {{state.missing}}!', ctx({}))
    // Should not throw; keeps original when not found
    expect(result).toBe('Hello {{state.missing}}!')
  })

  it('handles numeric values', () => {
    expect(resolveTemplate('Total: {{state.total}}', ctx({ total: 9999 }))).toBe('Total: 9999')
  })
})

describe('resolveTemplateObject', () => {
  it('resolves templates in all string values of an object', () => {
    const result = resolveTemplateObject(
      { greeting: 'Hello {{state.name}}', count: '{{state.n}} items' },
      ctx({ name: 'Alice', n: 3 }),
    )
    expect(result['greeting']).toBe('Hello Alice')
    expect(result['count']).toBe('3 items')
  })

  it('leaves non-string values unchanged', () => {
    const result = resolveTemplateObject({ num: 42, flag: true } as Record<string, unknown>, ctx())
    expect(result['num']).toBe(42)
    expect(result['flag']).toBe(true)
  })

  it('handles nested objects recursively', () => {
    const result = resolveTemplateObject(
      { outer: { inner: '{{state.val}}' } } as Record<string, unknown>,
      ctx({ val: 'deep' }),
    )
    expect((result['outer'] as Record<string, string>)['inner']).toBe('deep')
  })
})

describe('parseDuration', () => {
  it('parses minutes', () => {
    expect(parseDuration('5m')).toBe(5 * 60 * 1000)
  })

  it('parses hours', () => {
    expect(parseDuration('2h')).toBe(2 * 60 * 60 * 1000)
  })

  it('parses days', () => {
    expect(parseDuration('1d')).toBe(24 * 60 * 60 * 1000)
  })

  it('parses seconds', () => {
    expect(parseDuration('30s')).toBe(30 * 1000)
  })

  it('throws on invalid format', () => {
    expect(() => parseDuration('???')).toThrow('Invalid duration')
  })

  it('handles decimal values', () => {
    expect(parseDuration('1.5h')).toBe(1.5 * 60 * 60 * 1000)
  })
})
