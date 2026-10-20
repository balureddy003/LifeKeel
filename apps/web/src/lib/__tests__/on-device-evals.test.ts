/**
 * Device-first eval gate (CI half).
 *
 * Two checks that must hold before any task ships on-device:
 *
 *   1. FLOOR — the deterministic template must pass the output guard on
 *      EVERY golden case. If the offline fallback isn't guard-clean, the
 *      opted-in "never leave this device" path is broken by construction.
 *
 *   2. RECALL — every simulated SLM failure mode must be rejected by the
 *      production unwrap+guard pipeline, with a negative-control case that
 *      must be ACCEPTED so a blanket-reject guard can't fake recall.
 *
 * The runtime eval (runDeviceDraftEvals against generateDraftOnDevice in a
 * real browser/device) uses the same cases and verdict — see the final
 * describe block, which proves the plumbing against a mock provider.
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  DRAFT_EVAL_CASES,
  ADVERSARIAL_OUTPUT_CASES,
  runDeviceDraftEvals,
  runGuardRejectionEvals,
  runFloorEvals,
} from '../on-device-evals'
import { generateDraftOnDeviceDetailed, buildDeterministicStepDraft } from '../onDeviceLlm'

afterEach(() => {
  delete (globalThis as any).LanguageModel
  delete (globalThis as any).ai
  delete (globalThis as any).Capacitor
})

describe('device eval gate: floor (deterministic template)', () => {
  it('the offline fallback is guard-clean on every golden case', async () => {
    const verdict = await runFloorEvals()
    // A miss here is a blocker, not a metric — list the offending cases.
    const failures = verdict.results.filter((r) => !r.accepted || (r.missing?.length ?? 0) > 0)
    expect(failures).toEqual([])
    expect(verdict.pass).toBe(true)
    expect(verdict.guardClean).toBe(verdict.total)
  })

  it('template drafts preserve every required identifier', async () => {
    const verdict = await runDeviceDraftEvals(DRAFT_EVAL_CASES, buildDeterministicStepDraft)
    expect(verdict.complete).toBe(verdict.total)
    for (const r of verdict.results) expect(r.missing ?? []).toEqual([])
  })
})

describe('device eval gate: guard recall (adversarial corpus)', () => {
  it('rejects every simulated SLM failure mode', () => {
    const verdict = runGuardRejectionEvals(ADVERSARIAL_OUTPUT_CASES)
    expect(verdict.misses).toEqual([])
    expect(verdict.pass).toBe(true)
  })
})

describe('device eval gate: runtime plumbing (mock provider)', () => {
  it('a compliant runtime output passes the gate end-to-end', async () => {
    ;(globalThis as any).LanguageModel = {
      availability: async () => 'available',
      create: async () => ({
        prompt: async () =>
          JSON.stringify({
            body: 'Hello,\n\nWriting to check the status of policy 44109872.\n\nThank you,',
          }),
        destroy: () => {},
      }),
    }
    // Mock emits a fixed compliant draft; numeral must be in source or the
    // guard rejects — use a case whose source contains it.
    const verdict = await runDeviceDraftEvals(
      DRAFT_EVAL_CASES.filter((c) => c.stepBody.includes('44109872')),
      async (stepBody) => (await generateDraftOnDeviceDetailed(stepBody)).draft,
    )
    expect(verdict.pass).toBe(true)
    expect(verdict.generated).toBe(verdict.total)
  })

  it('a degenerate runtime output fails the gate', async () => {
    ;(globalThis as any).LanguageModel = {
      availability: async () => 'available',
      create: async () => ({
        prompt: async () =>
          JSON.stringify({ body: 'We recommend you switch to a cheaper deal elsewhere today.' }),
        destroy: () => {},
      }),
    }
    const verdict = await runDeviceDraftEvals(
      DRAFT_EVAL_CASES.slice(0, 3),
      async (stepBody) => (await generateDraftOnDeviceDetailed(stepBody)).draft,
    )
    expect(verdict.generated).toBe(0)
    expect(verdict.pass).toBe(false)
  })
})
