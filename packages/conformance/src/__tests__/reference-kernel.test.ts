import { describe, expect, it } from 'vitest'
import {
  assessOutcome,
  canTransition,
  evaluateReadiness,
  transitionOutcome,
} from '@lifekeel/outcome-kernel'
import { runOutcomeKernelConformance } from '../index.js'

describe('reference outcome kernel conformance', () => {
  it('passes all core conformance checks', () => {
    const results = runOutcomeKernelConformance({
      canTransition,
      transition: transitionOutcome,
      readiness: evaluateReadiness,
      assess: assessOutcome,
    })

    expect(results.filter(result => !result.passed)).toEqual([])
  })
})
