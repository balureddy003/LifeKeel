/**
 * Layer-B contextual-PII classifier — the model-backed half of the redaction
 * curtain (ARCHITECTURE.md §8.4a). The deterministic recognizers in
 * onDeviceLlm.ts catch PII with a structural anchor (titled names, numbered
 * addresses, DoB keywords); this module catches the unanchored cases — a bare
 * "Sarah said…", "we moved to Leeds", an employer name without "works at".
 *
 * Model: Xenova/bert-base-NER — dslim/bert-base-NER (BERT fine-tuned on
 * CoNLL-03: PER/ORG/LOC/MISC) with official ONNX quantizations maintained by
 * the transformers.js author. Chosen for provenance over footprint; the
 * ~15 MB onnx-community/TinyBERT-finetuned-NER-ONNX is the documented
 * smaller alternative IF it clears the eval gate (on-device-evals.ts
 * NER_EVAL_CASES) — do not shrink the model without running it.
 *
 * Privacy posture: inference is fully on-device (WebGPU where present, WASM
 * otherwise). Model *weights* download once from huggingface.co on first use
 * and stay in the browser cache — that request carries no user content, but
 * it is a device→HF network call; vendoring the weights onto LifeKeel infra
 * is future work. The classifier loads only when the user has enabled
 * on-device AI — the deterministic curtain stays the floor for everyone.
 */

/** transformers.js pipeline option for the int8 (WASM-safe) quantization. */
export const NER_MODEL_ID = 'Xenova/bert-base-NER'
export const NER_DTYPE = 'q8'

/**
 * First load downloads ~110 MB of int8 weights — generous timeout; inference
 * itself is tens of ms. A hung classifier must never block an egress call.
 */
const NER_LOAD_TIMEOUT_MS = 180_000
const NER_INFER_TIMEOUT_MS = 5_000

/** Below this confidence an entity span is too likely a false positive to
 *  be worth mangling the user's prose over. */
const NER_MIN_SCORE = 0.75

export type NerCategory = 'PERSON' | 'ORG' | 'LOC' | 'MISC'

export interface NerEntity {
  category: NerCategory
  text: string
  score?: number | undefined
}

export type NerClassifierFn = (text: string) => Promise<NerEntity[]>

// Same toggle the drafting tiers use — the NER model only loads for users
// who enabled on-device AI; everyone else keeps the deterministic curtain.
import { isOnDeviceEnabled } from './onDeviceLlm'

const LABEL_TO_CATEGORY: Record<string, NerCategory> = {
  PER: 'PERSON',
  ORG: 'ORG',
  LOC: 'LOC',
  MISC: 'MISC',
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

interface RawTokenResult {
  entity?: string // "B-PER" / "I-PER" / "O" when unaggregated
  entity_group?: string // "PER" when aggregation_strategy ran
  word?: string
  start?: number
  end?: number
  score?: number
}

/**
 * Normalize whatever the pipeline returned — grouped rows (entity_group,
 * whole word span) or raw per-token rows (B-/I- labels merged by
 * adjacency). Defensive on purpose: the runtime shape is unit-tested here
 * against fixtures, but the exact option support varies across
 * transformers.js versions.
 */
export function normalizeNerOutput(rows: RawTokenResult[], source: string): NerEntity[] {
  const out: NerEntity[] = []
  let open: { category: NerCategory; start: number; end: number; score: number } | null = null
  const flush = () => {
    if (open) {
      out.push({
        category: open.category,
        text: source.slice(open.start, open.end),
        score: open.score,
      })
      open = null
    }
  }
  for (const row of rows) {
    const grouped = row.entity_group
    if (grouped) {
      flush()
      const category = LABEL_TO_CATEGORY[grouped]
      if (category && typeof row.word === 'string') {
        out.push({
          category,
          text:
            typeof row.start === 'number' && typeof row.end === 'number'
              ? source.slice(row.start, row.end)
              : row.word,
          score: row.score,
        })
      }
      continue
    }
    const tag = row.entity ?? ''
    const match = /^([BI])-([A-Z]+)$/.exec(tag)
    const category = match ? LABEL_TO_CATEGORY[match[2]!] : undefined
    if (!category || typeof row.start !== 'number' || typeof row.end !== 'number') {
      flush()
      continue
    }
    const isBegin = match![1] === 'B'
    if (open && open.category === category && !isBegin) {
      open.end = row.end
      open.score = Math.min(open.score, row.score ?? 1)
    } else {
      flush()
      open = { category, start: row.start, end: row.end, score: row.score ?? 1 }
    }
  }
  flush()
  return out
}

let nerPipeline: any = null
let nerPromise: Promise<any | null> | null = null
// Bumped on unload so a slow first download cannot resurrect the model the
// user just turned off.
let nerGeneration = 0

async function loadPipeline(): Promise<any | null> {
  try {
    const { pipeline } = await import('@huggingface/transformers')
    const device = typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm'
    return await pipeline('token-classification', NER_MODEL_ID, {
      dtype: NER_DTYPE,
      device,
      aggregation_strategy: 'simple',
    } as any)
  } catch {
    return null
  }
}

/**
 * Memoized loader — concurrent curtain calls share one pipeline, failures
 * don't poison the cache (a retry gets a fresh attempt), and disable()
 * between start and finish drops the late result.
 */
export function loadNerClassifier(opts: { enabled?: boolean } = {}): Promise<any | null> {
  const enabled = opts.enabled ?? isOnDeviceEnabled()
  if (!enabled) return Promise.resolve(null)
  if (nerPipeline) return Promise.resolve(nerPipeline)
  if (!nerPromise) {
    const generation = nerGeneration
    nerPromise = withTimeout(loadPipeline(), NER_LOAD_TIMEOUT_MS).then((p) => {
      nerPromise = null
      // The toggle flipped off while weights were downloading — drop it.
      if (nerGeneration !== generation) return null
      nerPipeline = p
      return p
    })
  }
  return nerPromise
}

/** Drop the pipeline and prevent an in-flight load from re-arming it. */
export function unloadNerClassifier(): void {
  nerGeneration++
  const existing = nerPipeline
  nerPipeline = null
  nerPromise = null
  try {
    void existing?.dispose?.()
  } catch {
    // dispose is best-effort
  }
}

/** Best-effort eviction of cached ONNX weights from Cache Storage. */
export async function clearNerModelCache(): Promise<void> {
  try {
    const keys = await caches.keys()
    for (const key of keys) {
      const cache = await caches.open(key)
      for (const req of await cache.keys()) {
        if (req.url.includes(NER_MODEL_ID.split('/').pop()!)) {
          await cache.delete(req)
        }
      }
    }
  } catch {
    // Storage APIs vary — eviction is best-effort.
  }
}

/**
 * Classify contextual entities in free text. Returns [] when the model is
 * unavailable, disabled, timed out, or threw — the caller falls back to the
 * deterministic curtain unchanged. Precision filters live here: a low-score
 * or degenerate span never reaches the curtain at all.
 */
export async function classifyEntities(text: string): Promise<NerEntity[]> {
  if (!text.trim()) return []
  const pipe = await loadNerClassifier()
  if (!pipe) return []
  const rows = await withTimeout(
    Promise.resolve(pipe(text) as Promise<RawTokenResult[] | RawTokenResult>),
    NER_INFER_TIMEOUT_MS,
  ).catch(() => null)
  if (!rows) return []
  const entities = normalizeNerOutput(Array.isArray(rows) ? rows : [rows], text)
  return entities.filter((e) => {
    const trimmed = e.text.trim()
    if (trimmed.length < 2) return false
    if (e.score !== undefined && e.score < NER_MIN_SCORE) return false
    e.text = trimmed
    return true
  })
}
