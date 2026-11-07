/**
 * On-device speech to text. Follows the pattern in on-device-ner.ts: the model
 * runs entirely on the phone (WebGPU where present, WASM otherwise), the
 * weights download once from huggingface.co and stay in the browser cache, and
 * that download carries nothing the person says. No audio is sent anywhere,
 * stored, or kept after the text is made.
 *
 * Model: Xenova/whisper-tiny.en (OpenAI Whisper tiny, English, MIT licence;
 * ONNX int8 build maintained by the transformers.js author), roughly 40 MB.
 * Small on purpose so it can run on an ordinary phone; it will make mistakes,
 * which is why the words always go to the person to check before anything is
 * read from them.
 */

export const STT_MODEL_ID = 'Xenova/whisper-tiny.en'
export const STT_DTYPE = 'q8'
/** First load downloads the weights; be patient but never hang the page. */
export const STT_LOAD_TIMEOUT_MS = 180_000
export const STT_INFER_TIMEOUT_MS = 60_000
/** Whisper reads up to 30 s at a time; longer clips are cut. */
export const STT_MAX_SECONDS = 30
export const STT_SAMPLE_RATE = 16_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

/** Non-speech markers Whisper prints for silence and noise. */
const NON_SPEECH =
  /[[(*](?:blank_audio|silence|music|noise|applause|laughter|inaudible|[a-z ]{0,20}sound[a-z ]{0,10})[\])*]/gi

/**
 * Whatever the pipeline returned (an object, or a list of chunks) becomes
 * plain text, with silence markers removed. Defensive on purpose: the exact
 * output shape varies across transformers.js versions.
 */
export function normalizeSttOutput(out: unknown): string {
  const rows = Array.isArray(out) ? out : [out]
  const text = rows
    .map((r) =>
      r && typeof r === 'object' && 'text' in r ? String((r as { text: unknown }).text ?? '') : '',
    )
    .join(' ')
  return text.replace(NON_SPEECH, ' ').replace(/\s+/g, ' ').trim()
}

type SttPipeline = (audio: Float32Array, options?: Record<string, unknown>) => Promise<unknown>

let sttPipeline: SttPipeline | null = null
let sttPromise: Promise<SttPipeline | null> | null = null
// Bumped on unload so a slow first download cannot bring back a model the
// person just removed.
let sttGeneration = 0
let loaderOverride: (() => Promise<SttPipeline | null>) | null = null

/** Tests supply a fake model; production never calls this. */
export function __setSttLoaderForTests(fn: (() => Promise<SttPipeline | null>) | null): void {
  loaderOverride = fn
  sttPipeline = null
  sttPromise = null
  sttGeneration++
}

async function loadPipeline(): Promise<SttPipeline | null> {
  if (loaderOverride) return loaderOverride()
  try {
    const { pipeline } = await import('@huggingface/transformers')
    const device = typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm'
    return (await pipeline('automatic-speech-recognition', STT_MODEL_ID, {
      dtype: STT_DTYPE,
      device,
    } as never)) as unknown as SttPipeline
  } catch {
    return null
  }
}

/** Memoized: concurrent callers share one load, and a failure does not poison the cache. */
export function loadSttModel(): Promise<SttPipeline | null> {
  if (sttPipeline) return Promise.resolve(sttPipeline)
  if (!sttPromise) {
    const generation = sttGeneration
    sttPromise = withTimeout(loadPipeline(), STT_LOAD_TIMEOUT_MS).then((p) => {
      sttPromise = null
      if (sttGeneration !== generation) return null
      sttPipeline = p
      return p
    })
  }
  return sttPromise
}

/** Drop the model from memory and stop an in-flight load from re-arming it. */
export function unloadSttModel(): void {
  sttGeneration++
  sttPipeline = null
  sttPromise = null
}

/** Best-effort removal of the downloaded weights from Cache Storage. */
export async function clearSttModelCache(): Promise<void> {
  unloadSttModel()
  try {
    const keys = await caches.keys()
    for (const key of keys) {
      const cache = await caches.open(key)
      for (const req of await cache.keys()) {
        if (req.url.includes(STT_MODEL_ID.split('/').pop()!)) await cache.delete(req)
      }
    }
  } catch {
    // Storage APIs vary; removal is best-effort.
  }
}

export type SttResult =
  { ok: true; text: string } | { ok: false; reason: 'model' | 'timeout' | 'empty' }

/**
 * Turn 16 kHz mono audio into text. Returns a reason instead of throwing, so
 * the caller can always fall back to typing.
 */
export async function transcribe(audio: Float32Array): Promise<SttResult> {
  if (audio.length < STT_SAMPLE_RATE / 4) return { ok: false, reason: 'empty' }
  const model = await loadSttModel()
  if (!model) return { ok: false, reason: 'model' }
  const clip =
    audio.length > STT_MAX_SECONDS * STT_SAMPLE_RATE
      ? audio.subarray(0, STT_MAX_SECONDS * STT_SAMPLE_RATE)
      : audio
  const out = await withTimeout(
    Promise.resolve(model(clip, { chunk_length_s: STT_MAX_SECONDS })).catch(() => undefined),
    STT_INFER_TIMEOUT_MS,
  )
  if (out === null) return { ok: false, reason: 'timeout' }
  if (out === undefined) return { ok: false, reason: 'model' }
  const text = normalizeSttOutput(out)
  return text ? { ok: true, text } : { ok: false, reason: 'empty' }
}
