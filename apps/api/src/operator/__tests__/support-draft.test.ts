import { describe, expect, it } from 'vitest'
import { SUPPORT_DRAFT_SYSTEM_PROMPT as prompt } from '../support-draft.js'

describe('support reply draft prompt', () => {
  it('forbids claiming an action has been taken or is under way', () => {
    expect(prompt).toMatch(/never state or imply that anything has already been done/i)
    expect(prompt).toMatch(/flagged|escalated|being reviewed/i)
  })

  it('forbids inventing documents or account details', () => {
    expect(prompt).toMatch(
      /do not mention documents, uploads or account details the customer did not/i,
    )
  })

  it('tells the model to leave a placeholder for facts only the operator knows', () => {
    expect(prompt).toMatch(/bracketed placeholder/i)
  })

  it('keeps the advice-rule guardrails', () => {
    expect(prompt).toMatch(/never give financial\/investment\/insurance\/legal advice/i)
    expect(prompt).toMatch(/recommend specific providers/i)
  })
})
