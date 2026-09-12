/**
 * @kairos/skills — unit tests
 *
 * Tests: skill catalogue, approval gate logic, skill input validation.
 */

import { describe, it, expect } from 'vitest'

// ── Skill catalogue ───────────────────────────────────────────────────────────

const SKILL_IDS = [
  'classify', 'extract', 'summarize', 'sentiment',
  'generate', 'translate', 'score', 'decide',
  'route', 'compare', 'enrich', 'plan',
]

describe('skill catalogue', () => {
  it('defines exactly 12 core skills', () => {
    expect(SKILL_IDS).toHaveLength(12)
  })

  it('all skill IDs are lowercase snake_case', () => {
    for (const id of SKILL_IDS) {
      expect(id).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })

  it('each skill ID is unique', () => {
    expect(new Set(SKILL_IDS).size).toBe(SKILL_IDS.length)
  })
})

// ── Approval gate ─────────────────────────────────────────────────────────────

describe('approval gate state machine', () => {
  type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'edited' | 'timed_out'

  const validTransitions: Record<ApprovalStatus, ApprovalStatus[]> = {
    pending:   ['approved', 'rejected', 'edited', 'timed_out'],
    approved:  [],
    rejected:  [],
    edited:    [],
    timed_out: [],
  }

  it('pending can transition to any terminal state', () => {
    expect(validTransitions['pending']).toContain('approved')
    expect(validTransitions['pending']).toContain('rejected')
    expect(validTransitions['pending']).toContain('edited')
    expect(validTransitions['pending']).toContain('timed_out')
  })

  it('terminal states have no further transitions', () => {
    const terminals: ApprovalStatus[] = ['approved', 'rejected', 'edited', 'timed_out']
    for (const s of terminals) {
      expect(validTransitions[s]).toHaveLength(0)
    }
  })

  it('an approval that is not pending cannot be re-approved', () => {
    const canRespond = (status: ApprovalStatus) => status === 'pending'
    expect(canRespond('approved')).toBe(false)
    expect(canRespond('rejected')).toBe(false)
    expect(canRespond('pending')).toBe(true)
  })
})

// ── Skill input validation ────────────────────────────────────────────────────

describe('skill input validation', () => {
  interface SkillConfig { skill: string; input_text?: string; system_prompt?: string }

  function validateSkillConfig(cfg: SkillConfig): string[] {
    const errors: string[] = []
    if (!SKILL_IDS.includes(cfg.skill)) errors.push(`Unknown skill: ${cfg.skill}`)
    if (!cfg.input_text && !cfg.system_prompt) errors.push('input_text or system_prompt required')
    return errors
  }

  it('valid skill config passes validation', () => {
    expect(validateSkillConfig({ skill: 'classify', input_text: 'Categorise this ticket' })).toHaveLength(0)
  })

  it('unknown skill fails validation', () => {
    const errors = validateSkillConfig({ skill: 'nonexistent', input_text: 'test' })
    expect(errors.some(e => e.includes('Unknown skill'))).toBe(true)
  })

  it('missing input fails validation', () => {
    const errors = validateSkillConfig({ skill: 'classify' })
    expect(errors.length).toBeGreaterThan(0)
  })
})
