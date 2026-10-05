import { describe, expect, it } from 'vitest'
import { InMemoryOutcomeRepository } from '@lifekeel/runtime'
import { runOutcomeRepositoryConformance } from '../index.js'

describe('reference runtime conformance', () => {
  it('passes outcome repository checks', async () => {
    const results = await runOutcomeRepositoryConformance(new InMemoryOutcomeRepository())
    expect(results.filter(result => !result.passed)).toEqual([])
  })
})
