/**
 * PRD-113: on-device inference for crisis-flow drafts.
 *
 * Scoped narrowly to one call site — the life-event step draft
 * affordance (LifeEventPlaybookClient.tsx) — not the general Ask Oak
 * assistant or regular insight drafts, which stay cloud-only. See the
 * PRD's own reasoning: a small local model is a materially harder bet
 * for open-ended chat than for this narrow, templated draft-polish task.
 *
 * @mlc-ai/web-llm is dynamically imported so nobody who never touches
 * this feature pays for it in the main bundle.
 */

const STORAGE_KEY = 'agentoak:on-device-drafts'

// A named constant, not hardcoded inline — swappable after an empirical
// quality check against generate-draft.ts's cloud output (PRD-113's own
// "fast-follow, not blocking" note). ~1B params, 4-bit quantized —
// smallest end of what WebLLM's catalog treats as a usable instruct
// model, chosen to keep the one-time download reasonable on mobile.
const MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC'

// Byte-identical in intent to generate-draft.ts's SYSTEM_PROMPT — same
// draft-only framing, same "never invent details," same generic sign-
// off. Explicitly forbids naming a specific product/provider: CLAUDE.md's
// "second rule" applies here exactly as it does to the cloud path, but
// nothing server-side can validate a locally-generated draft, so this
// constraint has to hold on its own.
const SYSTEM_PROMPT = `You draft short, polite outreach messages for a family finance app called Agent Oak. Given a description of a step in a family's crisis checklist, write a brief email body (2-4 sentences) the family could send to their insurer or provider to follow up.

Rules:
- This is a DRAFT ONLY, for a human to review and send themselves. Never claim anything has been sent, scheduled, or already acted upon.
- Do not invent policy numbers, account numbers, or personal details that weren't given to you.
- Never recommend, compare, or name a specific product or provider to switch to — only reference what the family already has.
- Sign off generically (e.g. "Thank you,") with no name — the sender will add their own.
- Output only the email body text, no subject line, no commentary.`

// Cached module-level once loaded — enableOnDeviceModel is expected to
// be called once (Settings toggle), and every later draft reuses the
// same engine instance rather than reloading the model per request.
// The web-llm engine type only exists behind a dynamic import, so the
// cache holds the resolved-whatever — typed as the engine's surface once
// the import lands, not worth a hard dependency for one property.
let engine: any = null

export function isOnDeviceEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function setOnDeviceEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false')
  } catch {
    // Private browsing / storage-full — the toggle just won't persist
    // across reloads, not a functional failure worth surfacing.
  }
  if (!enabled) engine = null
}

/**
 * Best-effort presence check — a full capability probe requires
 * requesting a real GPU adapter, which enableOnDeviceModel does lazily
 * on first actual use rather than on every page load.
 */
export function isOnDeviceSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

/**
 * Triggers the one-time model download into IndexedDB (cached there by
 * WebLLM itself — not re-downloaded on subsequent calls or reloads).
 * Returns false on any failure (unsupported hardware, network failure
 * mid-download, out of storage) rather than throwing — callers treat
 * this as "on-device isn't available right now," not an error to show.
 */
export async function enableOnDeviceModel(onProgress?: (pct: number) => void): Promise<boolean> {
  if (!isOnDeviceSupported()) return false
  try {
    const webllm = await import('@mlc-ai/web-llm')
    engine = await webllm.CreateMLCEngine(MODEL_ID, {
      initProgressCallback: (report: { progress: number }) => {
        onProgress?.(Math.round(report.progress * 100))
      },
    })
    return true
  } catch {
    engine = null
    return false
  }
}

/**
 * Generates a draft entirely client-side, given the step's already-
 * fetched body text. Nothing about the insight, the family's policies,
 * or the draft's content is sent to any server for this call. Returns
 * null on any failure — the caller falls back to the existing cloud
 * `prepareLifeEventStepDraft` path, never surfacing a raw error.
 */
export async function generateDraftOnDevice(stepBody: string): Promise<string | null> {
  if (!engine) {
    const ready = await enableOnDeviceModel()
    if (!ready) return null
  }
  try {
    const reply = await engine.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Checklist step: ${stepBody}\n\nWrite the draft email body.` },
      ],
    })
    return reply?.choices?.[0]?.message?.content ?? null
  } catch {
    return null
  }
}
