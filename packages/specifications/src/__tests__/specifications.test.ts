import { describe, expect, it } from 'vitest'
import { LIFEKEEL_SPEC_VERSION } from '../index.js'

describe('LifeKeel specifications', () => {
  it('publishes an explicit semantic version', () => {
    expect(LIFEKEEL_SPEC_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
