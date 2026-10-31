import { beforeEach, describe, expect, it } from 'vitest'
import { safeNext, stashReturnTo, takeReturnTo } from '../return-to'

describe('return-to', () => {
  beforeEach(() => sessionStorage.clear())

  it('accepts same-site paths only', () => {
    expect(safeNext('/b/abc123')).toBe('/b/abc123')
    expect(safeNext('/briefs?x=1')).toBe('/briefs?x=1')
    for (const bad of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      'b/abc',
      '',
      null,
      undefined,
    ])
      expect(safeNext(bad as string | null | undefined)).toBeNull()
  })

  it('parks a path across a redirect and gives it back exactly once', () => {
    stashReturnTo('/b/abc123')
    expect(takeReturnTo()).toBe('/b/abc123')
    expect(takeReturnTo()).toBeNull()
  })

  it('never parks an unsafe path, and clears an older one', () => {
    stashReturnTo('/b/abc123')
    stashReturnTo('//evil.example')
    expect(takeReturnTo()).toBeNull()
  })

  it('ignores a tampered stored value', () => {
    sessionStorage.setItem('lifekeel_return_to', 'https://evil.example')
    expect(takeReturnTo()).toBeNull()
  })
})
