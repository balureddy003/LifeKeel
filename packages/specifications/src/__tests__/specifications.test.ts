import { describe, expect, it } from 'vitest'
import { KAIROS_SPEC_VERSION } from '../index.js'

describe('Kairos specifications', () => {
  it('publishes an explicit semantic version', () => {
    expect(KAIROS_SPEC_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
