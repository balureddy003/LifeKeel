import { describe, it, expect } from 'vitest'
import { readableHypothesis } from '../insight-text'

describe('readableHypothesis', () => {
  it('turns a rule id into a sentence-style label', () => {
    expect(readableHypothesis('estate_no_will')).toBe('Estate no will')
    expect(readableHypothesis('no_income_protection')).toBe('No income protection')
  })
  it('leaves real sentences alone', () => {
    expect(readableHypothesis('No will on file in the Estate Vault')).toBe('No will on file in the Estate Vault')
    expect(readableHypothesis('Protection')).toBe('Protection')
  })
})
